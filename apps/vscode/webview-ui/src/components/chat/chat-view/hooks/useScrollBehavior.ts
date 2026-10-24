import { ClineMessage } from "@shared/ExtensionMessage"
import debounce from "debounce"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useEvent } from "react-use"
import { ListRange, VirtuosoHandle } from "react-virtuoso"
import { ScrollBehavior } from "../types/chatTypes"


/**
 * Custom hook for managing scroll behavior
 * Handles auto-scrolling, manual scrolling, and scroll-to-message functionality
 */
export function useScrollBehavior(
	messages: ClineMessage[],
	visibleMessages: ClineMessage[],
	groupedMessages: (ClineMessage | ClineMessage[])[],
	expandedRows: Record<number, boolean>,
	setExpandedRows: React.Dispatch<React.SetStateAction<Record<number, boolean>>>,
): ScrollBehavior & {
	isAtBottom: boolean
	setIsAtBottom: React.Dispatch<React.SetStateAction<boolean>>
	pendingScrollToMessage: number | null
	setPendingScrollToMessage: React.Dispatch<React.SetStateAction<number | null>>
	lastUserMessage: ClineMessage | null
	scrolledPastUserMessage: ClineMessage | null
	handleRangeChanged: (range: ListRange) => void
} {
	// Refs
	const virtuosoRef = useRef<VirtuosoHandle>(null)
	const scrollContainerRef = useRef<HTMLDivElement>(null)
	const disableAutoScrollRef = useRef(false)
	const layoutSettleScrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

	// State
	const [isAtBottom, setIsAtBottom] = useState(false)
	const [pendingScrollToMessage, setPendingScrollToMessage] = useState<number | null>(null)

	// Find the most recent user prompt in multi-step workflows (index >= 1)
	const lastUserMessage = useMemo(() => {
		for (let i = messages.length - 1; i >= 1; i--) {
			const msg = messages[i]
			if (
				(msg.say === "user_feedback" || msg.say === "user_feedback_diff") &&
				(msg.text?.trim() || (msg.images && msg.images.length > 0) || (msg.files && msg.files.length > 0))
			) {
				return msg
			}
		}
		return null
	}, [messages])

	// Handler for when visible range changes in Virtuoso (kept for compatibility)
	const handleRangeChanged = useCallback((_range: ListRange) => {
		// Range changed callback - keep this for potential future use
	}, [])
	const scrollToBottomSmooth = useMemo(
		() =>
			debounce(
				() => {
					virtuosoRef.current?.scrollTo({
						top: Number.MAX_SAFE_INTEGER,
						behavior: "smooth",
					})
				},
				10,
				{ immediate: true },
			),
		[],
	)

	// Smooth scroll to bottom with debounce
	const scrollToBottomAuto = useCallback(() => {
		virtuosoRef.current?.scrollTo({
			top: Number.MAX_SAFE_INTEGER,
			behavior: "auto", // instant causes crash
		})
	}, [])

	const scrollToMessage = useCallback(
		(messageOrIndex: number | ClineMessage) => {
			const targetMessage =
				typeof messageOrIndex === "number" ? messages[messageOrIndex] : messageOrIndex
			if (!targetMessage) {
				setPendingScrollToMessage(null)
				return
			}

			let groupIndex = -1

			for (let i = 0; i < groupedMessages.length; i++) {
				const group = groupedMessages[i]
				if (Array.isArray(group)) {
					const messageInGroup = group.some((msg) => msg.ts === targetMessage.ts)
					if (messageInGroup) {
						groupIndex = i
						break
					}
				} else {
					if (group.ts === targetMessage.ts) {
						groupIndex = i
						break
					}
				}
			}

			if (groupIndex !== -1) {
				setPendingScrollToMessage(null)
				disableAutoScrollRef.current = true

				// Use scrollToIndex - Virtuoso handles this reliably
				requestAnimationFrame(() => {
					virtuosoRef.current?.scrollToIndex({
						index: groupIndex,
						align: "start",
						behavior: "smooth",
					})
				})
			} else if (typeof messageOrIndex === "number") {
				setPendingScrollToMessage(messageOrIndex)
			}
		},
		[messages, groupedMessages],
	)

	// scroll when user toggles certain rows
	const toggleRowExpansion = useCallback(
		(ts: number, options?: { preserveAutoScroll?: boolean }) => {
			const isCollapsing = expandedRows[ts] ?? false
			const lastGroup = groupedMessages.at(-1)
			const isLast = Array.isArray(lastGroup) ? lastGroup[0].ts === ts : lastGroup?.ts === ts
			const secondToLastGroup = groupedMessages.at(-2)
			const isSecondToLast = Array.isArray(secondToLastGroup)
				? secondToLastGroup[0].ts === ts
				: secondToLastGroup?.ts === ts

			const isLastCollapsedApiReq =
				isLast &&
				!Array.isArray(lastGroup) && // Make sure it's not a browser session group
				lastGroup?.say === "api_req_started" &&
				!expandedRows[lastGroup.ts]

			setExpandedRows((prev) => ({
				...prev,
				[ts]: !prev[ts],
			}))

			// Disable auto-scroll when the user expands a row. Programmatic expansions
			// for active command output should keep bottom pinning engaged.
			if (!isCollapsing && !options?.preserveAutoScroll) {
				disableAutoScrollRef.current = true
			}
			// Only scroll on collapse, never on expand - expanding should stay in place
			if (isCollapsing && isAtBottom) {
				const timer = setTimeout(() => {
					scrollToBottomAuto()
				}, 0)
				return () => clearTimeout(timer)
			}
			if (isCollapsing && (isLast || isSecondToLast)) {
				if (isSecondToLast && !isLastCollapsedApiReq) {
					return
				}
				const timer = setTimeout(() => {
					scrollToBottomAuto()
				}, 0)
				return () => clearTimeout(timer)
			}
			// When expanding, don't scroll - let the element expand in place
		},
		[groupedMessages, expandedRows, scrollToBottomAuto, isAtBottom],
	)

	const isStreaming = useMemo(() => messages.at(-1)?.partial === true, [messages])

	const prevStreamingRef = useRef(isStreaming)
	useEffect(() => {
		const wasStreaming = prevStreamingRef.current
		prevStreamingRef.current = isStreaming
		// Once prompt changes / streaming completes, re-engage auto-scroll and scroll to the latest information
		if (wasStreaming && !isStreaming) {
			disableAutoScrollRef.current = false
			scrollToBottomAuto()
			const t1 = setTimeout(() => {
				scrollToBottomAuto()
			}, 50)
			const t2 = setTimeout(() => {
				scrollToBottomAuto()
			}, 150)
			return () => {
				clearTimeout(t1)
				clearTimeout(t2)
			}
		}
	}, [isStreaming, scrollToBottomAuto, disableAutoScrollRef])

	const clearLayoutSettleScrollTimers = useCallback(() => {
		if (layoutSettleScrollTimerRef.current !== null) {
			clearTimeout(layoutSettleScrollTimerRef.current)
			layoutSettleScrollTimerRef.current = null
		}
	}, [])

	const keepPinnedToBottomAfterLayout = useCallback(() => {
		if (disableAutoScrollRef.current) {
			return
		}

		// During active streaming, scroll instantly to eliminate vertical jitter
		if (isStreaming) {
			scrollToBottomAuto()
			return
		}

		if (layoutSettleScrollTimerRef.current !== null) {
			clearTimeout(layoutSettleScrollTimerRef.current)
		}
		layoutSettleScrollTimerRef.current = setTimeout(() => {
			if (!disableAutoScrollRef.current) {
				scrollToBottomSmooth()
			}
			layoutSettleScrollTimerRef.current = null
		}, 500)
	}, [disableAutoScrollRef, isStreaming, scrollToBottomAuto, scrollToBottomSmooth])

	const handleRowHeightChange = useCallback(
		(_isTaller: boolean) => {
			keepPinnedToBottomAfterLayout()
		},
		[keepPinnedToBottomAfterLayout],
	)

	const handleLastRowContentChange = useCallback(() => {
		keepPinnedToBottomAfterLayout()
	}, [keepPinnedToBottomAfterLayout])

	useEffect(() => clearLayoutSettleScrollTimers, [clearLayoutSettleScrollTimers])

	useEffect(() => {
		if (!disableAutoScrollRef.current) {
			if (isStreaming) {
				scrollToBottomAuto()
			} else {
				scrollToBottomSmooth()
				setTimeout(() => {
					if (!disableAutoScrollRef.current) {
						scrollToBottomAuto()
					}
				}, 40)
				setTimeout(() => {
					if (!disableAutoScrollRef.current) {
						scrollToBottomAuto()
					}
				}, 70)
			}
		}
	}, [groupedMessages.length, isStreaming, scrollToBottomSmooth, scrollToBottomAuto])

	useEffect(() => {
		if (pendingScrollToMessage !== null) {
			scrollToMessage(pendingScrollToMessage)
		}
	}, [pendingScrollToMessage, groupedMessages, scrollToMessage])

	const handleWheel = useCallback((event: Event) => {
		const wheelEvent = event as WheelEvent
		if (wheelEvent.deltaY && wheelEvent.deltaY < 0) {
			if (scrollContainerRef.current?.contains(wheelEvent.target as Node)) {
				// user scrolled up
				disableAutoScrollRef.current = true
			}
		}
	}, [])
	useEvent("wheel", handleWheel, window, { passive: true }) // passive improves scrolling performance

	return {
		virtuosoRef,
		scrollContainerRef,
		disableAutoScrollRef,
		scrollToBottomSmooth,
		scrollToBottomAuto,
		scrollToMessage,
		toggleRowExpansion,
		handleRowHeightChange,
		handleLastRowContentChange,
		isAtBottom,
		setIsAtBottom,
		pendingScrollToMessage,
		setPendingScrollToMessage,
		lastUserMessage,
		scrolledPastUserMessage: lastUserMessage,
		handleRangeChanged,
	}
}

import { act, renderHook } from "@testing-library/react"
import type { MutableRefObject } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useScrollBehavior } from "./useScrollBehavior"

const commandMessage = {
	ts: 1,
	type: "ask",
	ask: "command",
	text: "echo hi",
}

describe("useScrollBehavior", () => {
	beforeEach(() => {
		vi.useFakeTimers()
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	it("scrolls to bottom after command output layout has been quiet for 500ms", () => {
		const { result } = renderHook(() => useScrollBehavior([], [], [], {}, vi.fn()))
		const scrollTo = vi.fn()
		act(() => {
			vi.runOnlyPendingTimers()
		})
		;(result.current.virtuosoRef as MutableRefObject<{ scrollTo: typeof scrollTo } | null>).current = { scrollTo }

		act(() => {
			result.current.handleLastRowContentChange()
		})

		expect(scrollTo).not.toHaveBeenCalled()

		act(() => {
			vi.advanceTimersByTime(499)
		})
		expect(scrollTo).not.toHaveBeenCalled()

		act(() => {
			vi.advanceTimersByTime(1)
		})
		expect(scrollTo).toHaveBeenCalledWith({
			top: Number.MAX_SAFE_INTEGER,
			behavior: "smooth",
		})
	})

	it("resets the 500ms wait when another command output change arrives", () => {
		const { result } = renderHook(() => useScrollBehavior([], [], [], {}, vi.fn()))
		const scrollTo = vi.fn()
		act(() => {
			vi.runOnlyPendingTimers()
		})
		;(result.current.virtuosoRef as MutableRefObject<{ scrollTo: typeof scrollTo } | null>).current = { scrollTo }

		act(() => {
			result.current.handleLastRowContentChange()
			scrollTo.mockClear()
			vi.advanceTimersByTime(400)
			result.current.handleLastRowContentChange()
			scrollTo.mockClear()
			vi.advanceTimersByTime(499)
		})
		expect(scrollTo).not.toHaveBeenCalled()

		act(() => {
			vi.advanceTimersByTime(1)
		})
		expect(scrollTo).toHaveBeenCalledWith({
			top: Number.MAX_SAFE_INTEGER,
			behavior: "smooth",
		})
	})

	it("does not re-pin command output changes after auto-scroll is disabled", () => {
		const { result } = renderHook(() => useScrollBehavior([], [], [], {}, vi.fn()))
		const scrollTo = vi.fn()
		;(result.current.virtuosoRef as MutableRefObject<{ scrollTo: typeof scrollTo } | null>).current = { scrollTo }

		act(() => {
			result.current.disableAutoScrollRef.current = true
			result.current.handleLastRowContentChange()
			vi.runAllTimers()
		})

		expect(scrollTo).not.toHaveBeenCalled()
	})

	it("disables auto-scroll when a user expands a row", () => {
		const { result } = renderHook(() => useScrollBehavior([], [], [commandMessage as any], {}, vi.fn()))

		act(() => {
			result.current.toggleRowExpansion(commandMessage.ts)
		})

		expect(result.current.disableAutoScrollRef.current).toBe(true)
	})

	it("keeps auto-scroll enabled when command output expands programmatically", () => {
		const { result } = renderHook(() => useScrollBehavior([], [], [commandMessage as any], {}, vi.fn()))

		act(() => {
			result.current.toggleRowExpansion(commandMessage.ts, { preserveAutoScroll: true })
		})

		expect(result.current.disableAutoScrollRef.current).toBe(false)
	})

	it("scrolls instantly with auto behavior when content changes during active streaming", () => {
		const streamingMessage = {
			ts: 2,
			type: "say",
			say: "text",
			text: "streaming chunk...",
			partial: true,
		}
		const { result } = renderHook(() => useScrollBehavior([streamingMessage as any], [], [], {}, vi.fn()))
		const scrollTo = vi.fn()
		;(result.current.virtuosoRef as MutableRefObject<{ scrollTo: typeof scrollTo } | null>).current = { scrollTo }

		act(() => {
			result.current.handleLastRowContentChange()
		})

		expect(scrollTo).toHaveBeenCalledWith({
			top: Number.MAX_SAFE_INTEGER,
			behavior: "auto",
		})
	})

	it("scrolls to latest information when prompt streaming completes", () => {
		const streamingMessage = {
			ts: 2,
			type: "say",
			say: "text",
			text: "streaming chunk...",
			partial: true,
		}
		let currentMessages = [streamingMessage as any]
		const { result, rerender } = renderHook(
			({ msgs }) => useScrollBehavior(msgs, [], [], {}, vi.fn()),
			{ initialProps: { msgs: currentMessages } },
		)
		const scrollTo = vi.fn()
		;(result.current.virtuosoRef as MutableRefObject<{ scrollTo: typeof scrollTo } | null>).current = { scrollTo }

		act(() => {
			result.current.disableAutoScrollRef.current = true
		})

		const completedMessage = {
			...streamingMessage,
			partial: false,
		}
		currentMessages = [completedMessage as any]

		act(() => {
			rerender({ msgs: currentMessages })
		})

		expect(result.current.disableAutoScrollRef.current).toBe(false)
		expect(scrollTo).toHaveBeenCalledWith({
			top: Number.MAX_SAFE_INTEGER,
			behavior: "auto",
		})
	})

	it("returns null for lastUserMessage when only initial task message exists", () => {
		const taskMessage = {
			ts: 1,
			type: "say",
			say: "task",
			text: "Initial task prompt",
		}
		const { result } = renderHook(() => useScrollBehavior([taskMessage as any], [], [], {}, vi.fn()))
		expect(result.current.lastUserMessage).toBeNull()
	})

	it("picks the most recent user prompt in multi-step workflows", () => {
		const taskMessage = {
			ts: 1,
			type: "say",
			say: "task",
			text: "Initial task",
		}
		const botMessage1 = {
			ts: 2,
			type: "say",
			say: "text",
			text: "Done step 1",
		}
		const userPrompt1 = {
			ts: 3,
			type: "say",
			say: "user_feedback",
			text: "Step 2 instruction",
		}
		const botMessage2 = {
			ts: 4,
			type: "say",
			say: "text",
			text: "Done step 2",
		}
		const userPrompt2 = {
			ts: 5,
			type: "say",
			say: "user_feedback",
			text: "Step 3 instruction: please do this next",
		}
		const botMessage3 = {
			ts: 6,
			type: "say",
			say: "text",
			text: "Working on step 3...",
		}

		const messages = [
			taskMessage,
			botMessage1,
			userPrompt1,
			botMessage2,
			userPrompt2,
			botMessage3,
		] as any[]

		const { result } = renderHook(() => useScrollBehavior(messages, [], [], {}, vi.fn()))
		expect(result.current.lastUserMessage).toEqual(userPrompt2)
		expect(result.current.scrolledPastUserMessage).toEqual(userPrompt2)
	})

	it("scrolls to message using ClineMessage object", () => {
		const taskMessage = { ts: 1, type: "say", say: "task", text: "Task" }
		const userPrompt = { ts: 2, type: "say", say: "user_feedback", text: "Do more" }
		const botMessage = { ts: 3, type: "say", say: "text", text: "Sure" }

		const messages = [taskMessage, userPrompt, botMessage] as any[]
		const groupedMessages = [taskMessage, userPrompt, botMessage] as any[]

		const { result } = renderHook(() =>
			useScrollBehavior(messages, messages, groupedMessages, {}, vi.fn()),
		)

		const scrollToIndex = vi.fn()
		;(result.current.virtuosoRef as MutableRefObject<{ scrollToIndex: typeof scrollToIndex } | null>).current = {
			scrollToIndex,
		}

		act(() => {
			result.current.scrollToMessage(userPrompt as any)
		})

		// Flush requestAnimationFrame
		vi.runAllTimers()

		expect(scrollToIndex).toHaveBeenCalledWith({
			index: 1,
			align: "start",
			behavior: "smooth",
		})
	})
})

import { ClineMessage } from "@shared/ExtensionMessage"
import { PaperclipIcon, PinIcon } from "lucide-react"
import React, { memo, useCallback } from "react"
import { cn } from "@/lib/utils"
import { highlightText } from "./Highlights"

interface StickyUserMessageProps {
	readonly lastUserMessage: ClineMessage | null
	readonly onScrollToMessage?: () => void
	readonly isVisible?: boolean
}

/**
 * A pinned header component that displays the last user message/prompt
 * Pinned at the top of the chat area just below the task header,
 * allowing quick navigation back to the user's prompt in multi-step workflows.
 */
export const StickyUserMessage: React.FC<StickyUserMessageProps> = memo(
	({ lastUserMessage, onScrollToMessage, isVisible = true }) => {
		const handleClick = useCallback(() => {
			if (onScrollToMessage) {
				onScrollToMessage()
			}
		}, [onScrollToMessage])

		const handleKeyDown = useCallback(
			(e: React.KeyboardEvent) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault()
					if (onScrollToMessage) {
						onScrollToMessage()
					}
				}
			},
			[onScrollToMessage],
		)

		const hasImages = (lastUserMessage?.images?.length ?? 0) > 0
		const hasFiles = (lastUserMessage?.files?.length ?? 0) > 0
		const rawText = lastUserMessage?.text?.trim() || ""

		// Don't render if no user message, not visible, or completely empty
		if (!lastUserMessage || !isVisible || (!rawText && !hasImages && !hasFiles)) {
			return null
		}

		const displayText = rawText || (hasImages ? "(Images)" : "(Files)")

		return (
			<div
				aria-label={`Scroll to prompt: ${displayText}`}
				className={cn(
					"relative flex items-center px-2.5 py-1.5 cursor-pointer select-none",
					"backdrop-blur-sm transition-all",
					"hover:brightness-110",
				)}
				data-testid="pinned-last-prompt"
				onClick={handleClick}
				onKeyDown={handleKeyDown}
				role="button"
				style={{
					backgroundColor: "var(--vscode-badge-background)",
					borderRadius: "3px",
				}}
				tabIndex={0}
				title={`Click to scroll to prompt:\n${displayText}`}>
				<PinIcon className="w-3.5 h-3.5 shrink-0 mr-1.5 opacity-75 rotate-45" />
				<span className="text-xs font-semibold mr-1.5 shrink-0 opacity-80 uppercase tracking-wide">
					Prompt:
				</span>
				<div
					className={cn(
						"flex-1 min-w-0 text-sm text-badge-foreground",
						"overflow-hidden text-ellipsis whitespace-nowrap",
						"ph-no-capture",
					)}>
					{highlightText(displayText, false)}
				</div>
				{(hasImages || hasFiles) && (
					<PaperclipIcon className="w-3.5 h-3.5 shrink-0 ml-1.5 opacity-70" />
				)}
			</div>
		)
	},
	(prevProps, nextProps) => {
		return (
			prevProps.lastUserMessage?.ts === nextProps.lastUserMessage?.ts &&
			prevProps.lastUserMessage?.text === nextProps.lastUserMessage?.text &&
			prevProps.isVisible === nextProps.isVisible &&
			prevProps.lastUserMessage?.images?.length === nextProps.lastUserMessage?.images?.length &&
			prevProps.lastUserMessage?.files?.length === nextProps.lastUserMessage?.files?.length
		)
	},
)

StickyUserMessage.displayName = "StickyUserMessage"

import type { ClineMessage, ClineSayTool, TurnState } from "@shared/ExtensionMessage"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { LoaderCircleIcon } from "lucide-react"
import React, { useMemo } from "react"
import { ButtonActionType } from "../../shared/buttonConfig"

interface ProcessingStatusBarProps {
	turnState?: TurnState
	messages: ClineMessage[]
	lastMessage?: ClineMessage
	foregroundCommandRunning?: boolean
	canInteract: boolean
	primaryText?: string
	secondaryText?: string
	primaryAction?: ButtonActionType
	secondaryAction?: ButtonActionType
	onAction: (action: ButtonActionType, text?: string, images?: string[], files?: string[]) => void
	inputValue: string
	selectedImages: string[]
	selectedFiles: string[]
}

/**
 * Determine the user-friendly status text describing the agent's current activity.
 */
export function getProcessingStatus(
	messages: ClineMessage[],
	lastMessage: ClineMessage | undefined,
	foregroundCommandRunning?: boolean,
): { text: string } {
	if (foregroundCommandRunning) {
		return { text: "Running command..." }
	}

	// Check the latest messages backwards to find the most relevant active step
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i]

		if (msg.ask === "command_output" || msg.say === "command" || msg.ask === "command") {
			return { text: "Running command..." }
		}

		if (msg.say === "reasoning") {
			return { text: "Thinking..." }
		}

		if (msg.ask === "tool" || msg.say === "tool") {
			try {
				const tool = JSON.parse(msg.text || "{}") as ClineSayTool
				switch (tool.tool) {
					case "readFile":
						return { text: "Reading file..." }
					case "listFilesTopLevel":
					case "listFilesRecursive":
					case "listCodeDefinitionNames":
						return { text: "Exploring files..." }
					case "searchFiles":
						return { text: "Searching codebase..." }
					case "editedExistingFile":
					case "newFileCreated":
					case "fileDeleted":
						return { text: "Editing files..." }
					case "webFetch":
						return { text: "Fetching web page..." }
					case "webSearch":
						return { text: "Searching web..." }
					case "useSkill":
						return { text: "Using skill..." }
					case "summarizeTask":
						return { text: "Summarizing task..." }
					default:
						return { text: "Running tool..." }
				}
			} catch {
				return { text: "Running tool..." }
			}
		}

		if (msg.say === "api_req_started") {
			return { text: "Thinking..." }
		}

		if (msg.say === "text" && msg.partial) {
			return { text: "Responding..." }
		}
	}

	return { text: "Thinking..." }
}

/**
 * Pinned status bar in the chat footer displaying whether the agent is thinking, running a command,
 * or processing a tool request, with convenient cancel / action buttons.
 */
export const ProcessingStatusBar: React.FC<ProcessingStatusBarProps> = ({
	turnState,
	messages,
	lastMessage,
	foregroundCommandRunning,
	canInteract,
	primaryText,
	secondaryText,
	primaryAction,
	secondaryAction,
	onAction,
	inputValue,
	selectedImages,
	selectedFiles,
}) => {
	const status = useMemo(
		() => getProcessingStatus(messages, lastMessage, foregroundCommandRunning),
		[messages, lastMessage, foregroundCommandRunning],
	)

	const activeSecondaryAction = secondaryAction ?? (turnState?.phase === "streaming" ? "cancel" : undefined)
	const activeSecondaryText = secondaryText ?? (activeSecondaryAction ? "Cancel" : undefined)

	return (
		<div className="px-3.5 mb-1.5">
			<div className="flex items-center justify-between px-3 py-1.5 rounded-md bg-[var(--vscode-badge-background)]/10 border border-[var(--vscode-badge-background)]/20 text-xs">
				<div className="flex items-center gap-2 min-w-0 mr-2">
					<LoaderCircleIcon className="size-3.5 animate-spin text-[var(--vscode-progressBar-background)] shrink-0" />
					<span className="truncate font-medium text-[var(--vscode-foreground)] select-none">
						{status.text}
					</span>
				</div>
				<div className="flex items-center gap-1.5 shrink-0">
					{primaryText && primaryAction && (
						<VSCodeButton
							appearance="secondary"
							disabled={!canInteract}
							onClick={() => onAction(primaryAction, inputValue, selectedImages, selectedFiles)}
						>
							{primaryText}
						</VSCodeButton>
					)}
					{activeSecondaryText && activeSecondaryAction && (
						<VSCodeButton
							appearance="secondary"
							disabled={!canInteract}
							onClick={() => onAction(activeSecondaryAction, inputValue, selectedImages, selectedFiles)}
						>
							{activeSecondaryText}
						</VSCodeButton>
					)}
				</div>
			</div>
		</div>
	)
}

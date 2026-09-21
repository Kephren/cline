import { mentionRegex, mentionRegexGlobal } from "@shared/context-mentions"
import { StringRequest } from "@shared/proto/cline/common"
import { FileSearchRequest, FileSearchType, RelativePathsRequest } from "@shared/proto/cline/file"
import {
	CommitModelSelectionRequest,
	UnloadOllamaModelRequest,
	WriteProviderConfigPatch,
	WriteProviderConfigRequest,
} from "@shared/proto/cline/models"
import { toProtobufModelOverrides } from "@shared/proto-conversions/models/modelOverrides"
import { PlanActMode, TogglePlanActModeRequest } from "@shared/proto/cline/state"
import { type SlashCommand } from "@shared/slashCommands"
import { Mode } from "@shared/storage/types"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import {
	AtSignIcon,
	CpuIcon,
	DatabaseIcon,
	LoaderCircleIcon,
	MinusIcon,
	PlusIcon,
	PowerOffIcon,
	RefreshCwIcon,
	ThermometerIcon,
	TriangleAlertIcon,
	ZapIcon,
} from "lucide-react"
import type React from "react"
import { forwardRef, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import DynamicTextArea from "react-textarea-autosize"
import styled from "styled-components"
import ContextMenu from "@/components/chat/ContextMenu"
import { CHAT_CONSTANTS } from "@/components/chat/chat-view/constants"
import SlashCommandMenu from "@/components/chat/SlashCommandMenu"
import Thumbnails from "@/components/common/Thumbnails"
import { getModeSpecificFields } from "@/components/settings/utils/providerUtils"
import { Slider as ContextSlider } from "@/components/ui/slider"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { usePlatform } from "@/context/PlatformContext"
import { useNormalizedApiConfiguration } from "@/hooks/useNormalizedApiConfiguration"
import { cn } from "@/lib/utils"
import { FileServiceClient, ModelsServiceClient, StateServiceClient } from "@/services/grpc-client"
import {
	ContextMenuOptionType,
	getContextMenuOptionIndex,
	getContextMenuOptions,
	insertMention,
	insertMentionDirectly,
	removeMention,
	type SearchResult,
	shouldShowContextMenu,
} from "@/utils/context-mentions"
import { useMetaKeyDetection, useShortcut } from "@/utils/hooks"
import { isSafari } from "@/utils/platformUtils"
import {
	getMatchingSlashCommands,
	insertSlashCommand,
	removeSlashCommand,
	shouldShowSlashCommandsMenu,
	slashCommandDeleteRegex,
	slashCommandRegexGlobal,
	validateSlashCommand,
} from "@/utils/slash-commands"
import ClineRulesToggleModal from "../cline-rules/ClineRulesToggleModal"
import { getModeToggleDraftAction } from "./chat-textarea-mode-toggle"
import ServersToggleModal from "./ServersToggleModal"

const { MAX_IMAGES_AND_FILES_PER_MESSAGE } = CHAT_CONSTANTS

const getImageDimensions = (dataUrl: string): Promise<{ width: number; height: number }> => {
	return new Promise((resolve, reject) => {
		const img = new Image()
		img.onload = () => {
			if (img.naturalWidth > 7500 || img.naturalHeight > 7500) {
				reject(new Error("Image dimensions exceed maximum allowed size of 7500px."))
			} else {
				resolve({ width: img.naturalWidth, height: img.naturalHeight })
			}
		}
		img.onerror = (err) => {
			console.error("Failed to load image for dimension check:", err)
			reject(new Error("Failed to load image to check dimensions."))
		}
		img.src = dataUrl
	})
}

// Set to "File" option by default
const DEFAULT_CONTEXT_MENU_OPTION = getContextMenuOptionIndex(ContextMenuOptionType.File)

interface ChatTextAreaProps {
	inputValue: string
	activeQuote: string | null
	setInputValue: (value: string) => void
	sendingDisabled: boolean
	placeholderText: string
	selectedFiles: string[]
	selectedImages: string[]
	setSelectedImages: React.Dispatch<React.SetStateAction<string[]>>
	setSelectedFiles: React.Dispatch<React.SetStateAction<string[]>>
	onSend: () => void
	onSelectFilesAndImages: () => void
	shouldDisableFilesAndImages: boolean
	onHeightChange?: (height: number) => void
	onFocusChange?: (isFocused: boolean) => void
}

interface GitCommit {
	type: ContextMenuOptionType.Git
	value: string
	label: string
	description: string
}

const PLAN_MODE_COLOR = "var(--vscode-activityWarningBadge-background)"
const ACT_MODE_COLOR = "var(--vscode-focusBorder)"

const CONTEXT_SIZES = [1024, 2048, 4096, 8192, 16384, 32768, 65536, 131072, 262144, 524288, 1048576] as const

function formatContextSizeLabel(tokens: number): string {
	if (tokens >= 1024) {
		return `${Math.round(tokens / 1024)}K`
	}
	return `${tokens}`
}

function calculateLatestInferenceSpeed(messages: ReturnType<typeof useExtensionState>["clineMessages"]): string | null {
	if (!messages || messages.length === 0) return null

	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i]
		if (msg.type === "say") {
			if ((msg.say === "api_req_finished" || msg.say === "api_req_started") && msg.text) {
				try {
					const info = JSON.parse(msg.text)
					if (typeof info.tokensPerSecond === "number" && info.tokensPerSecond > 0) {
						return info.tokensPerSecond.toFixed(1)
					}
					if (
						typeof info.durationMs === "number" &&
						info.durationMs > 50 &&
						typeof info.tokensOut === "number" &&
						info.tokensOut > 0
					) {
						return (info.tokensOut / (info.durationMs / 1000)).toFixed(1)
					}
					const tokensOut = typeof info.tokensOut === "number" ? info.tokensOut : 0
					if (tokensOut > 0) {
						for (let j = i - 1; j >= 0; j--) {
							if (messages[j].type === "say" && messages[j].say === "api_req_started") {
								const durationSec = (msg.ts - messages[j].ts) / 1000
								if (durationSec > 0.05 && durationSec < 10000) {
									return (tokensOut / durationSec).toFixed(1)
								}
								break
							}
						}
					}
				} catch {
					// ignore
				}
			}
		}
	}
	return null
}

const SwitchContainer = styled.div<{ disabled: boolean }>`
	display: flex;
	align-items: center;
	background-color: transparent;
	border: 1px solid var(--vscode-input-border);
	border-radius: 12px;
	overflow: hidden;
	cursor: ${(props) => (props.disabled ? "not-allowed" : "pointer")};
	opacity: ${(props) => (props.disabled ? 0.5 : 1)};
	transform: scale(1);
	transform-origin: right center;
	margin-left: 0;
	user-select: none; // Prevent text selection
`

const Slider = styled.div.withConfig({
	shouldForwardProp: (prop) => !["isAct", "isPlan"].includes(prop),
})<{ isAct: boolean; isPlan?: boolean }>`
	position: absolute;
	height: 100%;
	width: 50%;
	background-color: ${(props) => (props.isPlan ? PLAN_MODE_COLOR : ACT_MODE_COLOR)};
	transition: transform 0.2s ease;
	transform: translateX(${(props) => (props.isAct ? "100%" : "0%")});
`

const ButtonGroup = styled.div`
	display: flex;
	align-items: center;
	gap: 4px;
	flex: 1;
	min-width: 0;
`

const ButtonContainer = styled.div`
	display: flex;
	align-items: center;
	gap: 3px;
	font-size: 10px;
	white-space: nowrap;
	min-width: 0;
	width: 100%;
`

const ModelContainer = styled.div`
	position: relative;
	display: flex;
	flex: 1;
	min-width: 0;
`

const ModelButtonWrapper = styled.div`
	display: inline-flex; // Make it shrink to content
	min-width: 0; // Allow shrinking
	max-width: 100%; // Don't overflow parent
`

const ModelDisplayButton = styled.a<{ isActive?: boolean; disabled?: boolean }>`
	padding: 0px 0px;
	height: 20px;
	width: 100%;
	min-width: 0;
	cursor: ${(props) => (props.disabled ? "not-allowed" : "pointer")};
	text-decoration: ${(props) => (props.isActive ? "underline" : "none")};
	color: ${(props) => (props.isActive ? "var(--vscode-foreground)" : "var(--vscode-descriptionForeground)")};
	display: flex;
	align-items: center;
	font-size: 10px;
	outline: none;
	user-select: none;
	opacity: ${(props) => (props.disabled ? 0.5 : 1)};
	pointer-events: ${(props) => (props.disabled ? "none" : "auto")};

	&:hover,
	&:focus {
		color: ${(props) => (props.disabled ? "var(--vscode-descriptionForeground)" : "var(--vscode-foreground)")};
		text-decoration: ${(props) => (props.disabled ? "none" : "underline")};
		outline: none;
	}

	&:active {
		color: ${(props) => (props.disabled ? "var(--vscode-descriptionForeground)" : "var(--vscode-foreground)")};
		text-decoration: ${(props) => (props.disabled ? "none" : "underline")};
		outline: none;
	}

	&:focus-visible {
		outline: none;
	}
`

const ModelButtonContent = styled.div`
	width: 100%;
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
`

const ModelSelectDropdown = styled.select`
	background-color: var(--vscode-dropdown-background);
	color: var(--vscode-dropdown-foreground);
	border: 1px solid var(--vscode-dropdown-border, var(--vscode-input-border));
	border-radius: 3px;
	height: 20px;
	font-size: 11px;
	width: 100%;
	min-width: 0;
	padding: 0 4px;
	cursor: pointer;
	outline: none;
	text-overflow: ellipsis;
	white-space: nowrap;

	&:hover {
		border-color: var(--vscode-focusBorder);
	}

	&:focus {
		border-color: var(--vscode-focusBorder);
	}

	option {
		background-color: var(--vscode-dropdown-background);
		color: var(--vscode-dropdown-foreground);
	}
`

const ChatTextArea = forwardRef<HTMLTextAreaElement, ChatTextAreaProps>(
	(
		{
			inputValue,
			setInputValue,
			sendingDisabled,
			placeholderText,
			selectedFiles,
			selectedImages,
			setSelectedImages,
			setSelectedFiles,
			onSend,
			onSelectFilesAndImages,
			shouldDisableFilesAndImages,
			onHeightChange,
			onFocusChange,
		},
		ref,
	) => {
		const {
			mode,
			apiConfiguration,
			openRouterModels,
			platform,
			localWorkflowToggles,
			globalWorkflowToggles,
			remoteWorkflowToggles,
			remoteConfigSettings,
			navigateToSettingsModelPicker,
			mcpServers,
			clineMessages,
			didHydrateState,
		} = useExtensionState()

		const latestInferenceSpeed = useMemo(() => calculateLatestInferenceSpeed(clineMessages), [clineMessages])
		const [isTextAreaFocused, setIsTextAreaFocused] = useState(false)
		const [isDraggingOver, setIsDraggingOver] = useState(false)
		const [gitCommits, setGitCommits] = useState<GitCommit[]>([])
		const [showSlashCommandsMenu, setShowSlashCommandsMenu] = useState(false)
		const [selectedSlashCommandsIndex, setSelectedSlashCommandsIndex] = useState(0)
		const [slashCommandsQuery, setSlashCommandsQuery] = useState("")
		const slashCommandsMenuContainerRef = useRef<HTMLDivElement>(null)

		const [thumbnailsHeight, setThumbnailsHeight] = useState(0)
		const [textAreaBaseHeight, setTextAreaBaseHeight] = useState<number | undefined>(undefined)
		const [showContextMenu, setShowContextMenu] = useState(false)
		const [cursorPosition, setCursorPosition] = useState(0)
		const [searchQuery, setSearchQuery] = useState("")
		const textAreaRef = useRef<HTMLTextAreaElement | null>(null)
		const [isMouseDownOnMenu, setIsMouseDownOnMenu] = useState(false)
		const highlightLayerRef = useRef<HTMLDivElement>(null)
		const [selectedMenuIndex, setSelectedMenuIndex] = useState(-1)
		const [selectedType, setSelectedType] = useState<ContextMenuOptionType | null>(null)
		const [justDeletedSpaceAfterMention, setJustDeletedSpaceAfterMention] = useState(false)
		const [justDeletedSpaceAfterSlashCommand, setJustDeletedSpaceAfterSlashCommand] = useState(false)
		const [intendedCursorPosition, setIntendedCursorPosition] = useState<number | null>(null)
		const contextMenuContainerRef = useRef<HTMLDivElement>(null)

		const [shownTooltipMode, setShownTooltipMode] = useState<Mode | null>(null)
		const [pendingInsertions, setPendingInsertions] = useState<string[]>([])
		const _shiftHoldTimerRef = useRef<NodeJS.Timeout | null>(null)
		const [showUnsupportedFileError, setShowUnsupportedFileError] = useState(false)
		const unsupportedFileTimerRef = useRef<NodeJS.Timeout | null>(null)
		const [showDimensionError, setShowDimensionError] = useState(false)
		const dimensionErrorTimerRef = useRef<NodeJS.Timeout | null>(null)

		const [fileSearchResults, setFileSearchResults] = useState<SearchResult[]>([])
		const [searchLoading, setSearchLoading] = useState(false)
		const [, metaKeyChar] = useMetaKeyDetection(platform)
		const { selectedProvider, selectedModelId, selectedModelInfo } = useNormalizedApiConfiguration(mode)
		// Images are attached regardless; when the selected model has no image input the thumbnails get a warning
		// badge and a notice offers to switch models. Unknown capability data fails open, like core does.
		const modelSupportsImages = selectedModelInfo.supportsImages !== false
		const unsupportedImagesAttached = selectedImages.length > 0 && !modelSupportsImages

		// Fetch git commits when Git is selected or when typing a hash
		useEffect(() => {
			if (selectedType === ContextMenuOptionType.Git || /^[a-f0-9]+$/i.test(searchQuery)) {
				FileServiceClient.searchCommits(StringRequest.create({ value: searchQuery || "" }))
					.then((response) => {
						if (response.commits) {
							const commits: GitCommit[] = response.commits.map(
								(commit: { hash: string; shortHash: string; subject: string; author: string; date: string }) => ({
									type: ContextMenuOptionType.Git,
									value: commit.hash,
									label: commit.subject,
									description: `${commit.shortHash} by ${commit.author} on ${commit.date}`,
								}),
							)
							setGitCommits(commits)
						}
					})
					.catch((error) => {
						console.error("Error searching commits:", error)
					})
			}
		}, [selectedType, searchQuery])

		const queryItems = useMemo(() => {
			return [
				{ type: ContextMenuOptionType.Problems, value: "problems" },
				{ type: ContextMenuOptionType.Terminal, value: "terminal" },
				...gitCommits,
			]
		}, [gitCommits])

		useEffect(() => {
			const handleClickOutside = (event: MouseEvent) => {
				if (contextMenuContainerRef.current && !contextMenuContainerRef.current.contains(event.target as Node)) {
					setShowContextMenu(false)
				}
			}

			if (showContextMenu) {
				document.addEventListener("mousedown", handleClickOutside)
			}

			return () => {
				document.removeEventListener("mousedown", handleClickOutside)
			}
		}, [showContextMenu, setShowContextMenu])

		useEffect(() => {
			const handleClickOutsideSlashMenu = (event: MouseEvent) => {
				if (
					slashCommandsMenuContainerRef.current &&
					!slashCommandsMenuContainerRef.current.contains(event.target as Node)
				) {
					setShowSlashCommandsMenu(false)
				}
			}

			if (showSlashCommandsMenu) {
				document.addEventListener("mousedown", handleClickOutsideSlashMenu)
			}

			return () => {
				document.removeEventListener("mousedown", handleClickOutsideSlashMenu)
			}
		}, [showSlashCommandsMenu])

		const handleMentionSelect = useCallback(
			(type: ContextMenuOptionType, value?: string) => {
				if (type === ContextMenuOptionType.NoResults) {
					return
				}

				if (
					type === ContextMenuOptionType.File ||
					type === ContextMenuOptionType.Folder ||
					type === ContextMenuOptionType.Git
				) {
					if (!value) {
						setSelectedType(type)
						setSearchQuery("")
						setSelectedMenuIndex(0)

						// Trigger search with the selected type
						if (type === ContextMenuOptionType.File || type === ContextMenuOptionType.Folder) {
							setSearchLoading(true)

							// Map ContextMenuOptionType to FileSearchType enum
							let searchType: FileSearchType | undefined
							if (type === ContextMenuOptionType.File) {
								searchType = FileSearchType.FILE
							} else if (type === ContextMenuOptionType.Folder) {
								searchType = FileSearchType.FOLDER
							}

							const myToken = ++latestSearchTokenRef.current
							FileServiceClient.searchFiles(
								FileSearchRequest.create({
									query: "",
									mentionsRequestId: String(myToken),
									selectedType: searchType,
								}),
							)
								.then((results) => {
									if (myToken !== latestSearchTokenRef.current) {
										// Stale response — a newer search has been issued.
										return
									}
									setFileSearchResults((results.results || []) as SearchResult[])
									setSearchLoading(false)
								})
								.catch((error) => {
									if (myToken !== latestSearchTokenRef.current) {
										return
									}
									console.error("Error searching files:", error)
									setFileSearchResults([])
									setSearchLoading(false)
								})
						}
						return
					}
				}

				setShowContextMenu(false)
				setSelectedType(null)
				const queryLength = searchQuery.length
				setSearchQuery("")

				if (textAreaRef.current) {
					let insertValue = value || ""
					if (type === ContextMenuOptionType.URL) {
						insertValue = value || ""
					} else if (type === ContextMenuOptionType.File || type === ContextMenuOptionType.Folder) {
						insertValue = value || ""
					} else if (type === ContextMenuOptionType.Problems) {
						insertValue = "problems"
					} else if (type === ContextMenuOptionType.Terminal) {
						insertValue = "terminal"
					} else if (type === ContextMenuOptionType.Git) {
						insertValue = value || ""
					}

					const { newValue, mentionIndex } = insertMention(
						textAreaRef.current.value,
						cursorPosition,
						insertValue,
						queryLength,
					)

					setInputValue(newValue)
					const newCursorPosition = newValue.indexOf(" ", mentionIndex + insertValue.length) + 1
					setCursorPosition(newCursorPosition)
					setIntendedCursorPosition(newCursorPosition)
					// textAreaRef.current.focus()

					// scroll to cursor
					setTimeout(() => {
						if (textAreaRef.current) {
							textAreaRef.current.blur()
							textAreaRef.current.focus()
						}
					}, 0)
				}
			},
			[setInputValue, cursorPosition, searchQuery],
		)

		const handleSlashCommandsSelect = useCallback(
			(command: SlashCommand) => {
				setShowSlashCommandsMenu(false)
				const queryLength = slashCommandsQuery.length
				setSlashCommandsQuery("")

				if (textAreaRef.current) {
					const { newValue, commandIndex } = insertSlashCommand(
						textAreaRef.current.value,
						command.name,
						queryLength,
						cursorPosition,
					)
					const newCursorPosition = newValue.indexOf(" ", commandIndex + 1 + command.name.length) + 1

					setInputValue(newValue)
					setCursorPosition(newCursorPosition)
					setIntendedCursorPosition(newCursorPosition)

					setTimeout(() => {
						if (textAreaRef.current) {
							textAreaRef.current.blur()
							textAreaRef.current.focus()
						}
					}, 0)
				}
			},
			[setInputValue, slashCommandsQuery, cursorPosition],
		)
		const handleKeyDown = useCallback(
			(event: React.KeyboardEvent<HTMLTextAreaElement>) => {
				const isSelectAllShortcut =
					(event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "a"
				if (isSelectAllShortcut) {
					event.preventDefault()
					event.stopPropagation()
					const textArea = event.currentTarget
					textArea.setSelectionRange(0, textArea.value.length)
					setCursorPosition(0)
					return
				}

				if (showSlashCommandsMenu) {
					if (event.key === "Escape") {
						setShowSlashCommandsMenu(false)
						setSlashCommandsQuery("")
						return
					}

					if (event.key === "ArrowUp" || event.key === "ArrowDown") {
						event.preventDefault()
						setSelectedSlashCommandsIndex((prevIndex) => {
							const direction = event.key === "ArrowUp" ? -1 : 1
							// Get commands with workflow toggles
							const allCommands = getMatchingSlashCommands(
								slashCommandsQuery,
								localWorkflowToggles,
								globalWorkflowToggles,
								remoteWorkflowToggles,
								remoteConfigSettings?.remoteGlobalWorkflows,
								mcpServers,
							)

							if (allCommands.length === 0) {
								return prevIndex
							}

							// Calculate total command count
							const totalCommandCount = allCommands.length

							// Create wraparound navigation - moves from last item to first and vice versa
							const newIndex = (prevIndex + direction + totalCommandCount) % totalCommandCount
							return newIndex
						})
						return
					}

					if ((event.key === "Enter" || event.key === "Tab") && selectedSlashCommandsIndex !== -1) {
						event.preventDefault()
						const commands = getMatchingSlashCommands(
							slashCommandsQuery,
							localWorkflowToggles,
							globalWorkflowToggles,
							remoteWorkflowToggles,
							remoteConfigSettings?.remoteGlobalWorkflows,
							mcpServers,
						)
						if (commands.length > 0) {
							handleSlashCommandsSelect(commands[selectedSlashCommandsIndex])
						}
						return
					}
				}
				if (showContextMenu) {
					if (event.key === "Escape") {
						setShowContextMenu(false)
						setSelectedType(null)
						setSelectedMenuIndex(DEFAULT_CONTEXT_MENU_OPTION)
						setSearchQuery("")
						return
					}

					if (event.key === "ArrowUp" || event.key === "ArrowDown") {
						event.preventDefault()
						setSelectedMenuIndex((prevIndex) => {
							const direction = event.key === "ArrowUp" ? -1 : 1
							const options = getContextMenuOptions(searchQuery, selectedType, queryItems, fileSearchResults)
							const optionsLength = options.length

							if (optionsLength === 0) {
								return prevIndex
							}

							// Find selectable options (non-URL types)
							const selectableOptions = options.filter(
								(option) =>
									option.type !== ContextMenuOptionType.URL && option.type !== ContextMenuOptionType.NoResults,
							)

							if (selectableOptions.length === 0) {
								return -1 // No selectable options
							}

							// Find the index of the next selectable option
							const currentSelectableIndex = selectableOptions.indexOf(options[prevIndex])

							const newSelectableIndex =
								(currentSelectableIndex + direction + selectableOptions.length) % selectableOptions.length

							// Find the index of the selected option in the original options array
							return options.indexOf(selectableOptions[newSelectableIndex])
						})
						return
					}
					if ((event.key === "Enter" || event.key === "Tab") && selectedMenuIndex !== -1) {
						event.preventDefault()
						const selectedOption = getContextMenuOptions(searchQuery, selectedType, queryItems, fileSearchResults)[
							selectedMenuIndex
						]
						if (
							selectedOption &&
							selectedOption.type !== ContextMenuOptionType.URL &&
							selectedOption.type !== ContextMenuOptionType.NoResults
						) {
							// Use label if it contains workspace prefix, otherwise use value
							const mentionValue = selectedOption.label?.includes(":") ? selectedOption.label : selectedOption.value
							handleMentionSelect(selectedOption.type, mentionValue)
						}
						return
					}
				}

				// Safari does not support InputEvent.isComposing (always false), so we need to fallback to keyCode === 229 for it
				const isComposing = isSafari ? event.nativeEvent.keyCode === 229 : (event.nativeEvent?.isComposing ?? false)
				if (event.key === "Enter" && !event.shiftKey && !isComposing) {
					event.preventDefault()

					if (!sendingDisabled) {
						// Note: don't set isTextAreaFocused to false here. The textarea keeps
						// DOM focus after sending, and clearing the flag without an actual
						// blur desyncs it permanently (programmatic .focus() on an
						// already-focused element never re-fires onFocus), which hides the
						// plan/act mode outline until a real blur/refocus cycle.
						onSend()
					}
				}

				if (event.key === "Backspace" && !isComposing) {
					const charBeforeCursor = inputValue[cursorPosition - 1]
					const charAfterCursor = inputValue[cursorPosition + 1]

					const charBeforeIsWhitespace =
						charBeforeCursor === " " || charBeforeCursor === "\n" || charBeforeCursor === "\r\n"
					const charAfterIsWhitespace =
						charAfterCursor === " " || charAfterCursor === "\n" || charAfterCursor === "\r\n"

					// Check if we're right after a space that follows a mention or slash command
					if (
						charBeforeIsWhitespace &&
						inputValue.slice(0, cursorPosition - 1).match(new RegExp(mentionRegex.source + "$"))
					) {
						// File mention handling
						const newCursorPosition = cursorPosition - 1
						if (!charAfterIsWhitespace) {
							event.preventDefault()
							textAreaRef.current?.setSelectionRange(newCursorPosition, newCursorPosition)
							setCursorPosition(newCursorPosition)
						}
						setCursorPosition(newCursorPosition)
						setJustDeletedSpaceAfterMention(true)
						setJustDeletedSpaceAfterSlashCommand(false)
					} else if (charBeforeIsWhitespace && inputValue.slice(0, cursorPosition - 1).match(slashCommandDeleteRegex)) {
						// New slash command handling
						const newCursorPosition = cursorPosition - 1
						if (!charAfterIsWhitespace) {
							event.preventDefault()
							textAreaRef.current?.setSelectionRange(newCursorPosition, newCursorPosition)
							setCursorPosition(newCursorPosition)
						}
						setCursorPosition(newCursorPosition)
						setJustDeletedSpaceAfterSlashCommand(true)
						setJustDeletedSpaceAfterMention(false)
					}
					// Handle the second backspace press for mentions or slash commands
					else if (justDeletedSpaceAfterMention) {
						const { newText, newPosition } = removeMention(inputValue, cursorPosition)
						if (newText !== inputValue) {
							event.preventDefault()
							setInputValue(newText)
							setIntendedCursorPosition(newPosition)
						}
						setJustDeletedSpaceAfterMention(false)
						setShowContextMenu(false)
					} else if (justDeletedSpaceAfterSlashCommand) {
						// New slash command deletion
						const { newText, newPosition } = removeSlashCommand(inputValue, cursorPosition)
						if (newText !== inputValue) {
							event.preventDefault()
							setInputValue(newText)
							setIntendedCursorPosition(newPosition)
						}
						setJustDeletedSpaceAfterSlashCommand(false)
						setShowSlashCommandsMenu(false)
					}
					// Default case - reset flags if none of the above apply
					else {
						setJustDeletedSpaceAfterMention(false)
						setJustDeletedSpaceAfterSlashCommand(false)
					}
				}
			},
			[
				onSend,
				showContextMenu,
				searchQuery,
				selectedMenuIndex,
				handleMentionSelect,
				selectedType,
				inputValue,
				cursorPosition,
				setInputValue,
				justDeletedSpaceAfterMention,
				queryItems,
				fileSearchResults,
				showSlashCommandsMenu,
				selectedSlashCommandsIndex,
				slashCommandsQuery,
				handleSlashCommandsSelect,
				sendingDisabled,
			],
		)

		// Effect to set cursor position after state updates
		useLayoutEffect(() => {
			if (intendedCursorPosition !== null && textAreaRef.current) {
				textAreaRef.current.setSelectionRange(intendedCursorPosition, intendedCursorPosition)
				setIntendedCursorPosition(null) // Reset the state after applying
			}
		}, [inputValue, intendedCursorPosition])

		useEffect(() => {
			if (pendingInsertions.length === 0 || !textAreaRef.current) {
				return
			}

			const path = pendingInsertions[0]
			const currentTextArea = textAreaRef.current
			const currentValue = currentTextArea.value
			const currentCursorPos =
				intendedCursorPosition ??
				(currentTextArea.selectionStart >= 0 ? currentTextArea.selectionStart : currentValue.length)

			const { newValue, mentionIndex } = insertMentionDirectly(currentValue, currentCursorPos, path)

			setInputValue(newValue)

			const newCursorPosition = mentionIndex + path.length + 2
			setIntendedCursorPosition(newCursorPosition)

			setPendingInsertions((prev) => prev.slice(1))
		}, [pendingInsertions, setInputValue])

		const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null)

		// Monotonic token; every searchFiles dispatch bumps it, and resolve
		// handlers drop their result when the token they captured at fire time
		// is no longer the latest. Prevents stale results from a cancelled or
		// superseded picker (e.g. "Add File" still in flight when user picks
		// "Add Folder") from clobbering fresh state.
		const latestSearchTokenRef = useRef(0)

		const handleInputChange = useCallback(
			(e: React.ChangeEvent<HTMLTextAreaElement>) => {
				const newValue = e.target.value
				const newCursorPosition = e.target.selectionStart
				setInputValue(newValue)
				setCursorPosition(newCursorPosition)
				let showMenu = shouldShowContextMenu(newValue, newCursorPosition)
				const showSlashCommandsMenu = shouldShowSlashCommandsMenu(newValue, newCursorPosition)

				// we do not allow both menus to be shown at the same time
				// the slash commands menu has precedence bc its a narrower component
				if (showSlashCommandsMenu) {
					showMenu = false
				}

				setShowSlashCommandsMenu(showSlashCommandsMenu)
				setShowContextMenu(showMenu)

				if (showSlashCommandsMenu) {
					// Find the slash nearest to cursor (before cursor position)
					const beforeCursor = newValue.slice(0, newCursorPosition)
					const slashIndex = beforeCursor.lastIndexOf("/")
					const query = newValue.slice(slashIndex + 1, newCursorPosition)
					setSlashCommandsQuery(query)
					setSelectedSlashCommandsIndex(0)
				} else {
					setSlashCommandsQuery("")
					setSelectedSlashCommandsIndex(0)
				}

				if (showMenu) {
					const lastAtIndex = newValue.lastIndexOf("@", newCursorPosition - 1)
					const query = newValue.slice(lastAtIndex + 1, newCursorPosition)
					setSearchQuery(query)

					if (query.length > 0) {
						setSelectedMenuIndex(0)

						// Clear any existing timeout
						if (searchTimeoutRef.current) {
							clearTimeout(searchTimeoutRef.current)
						}

						setSearchLoading(true)

						const searchType =
							selectedType === ContextMenuOptionType.File
								? FileSearchType.FILE
								: selectedType === ContextMenuOptionType.Folder
									? FileSearchType.FOLDER
									: undefined

						// Parse workspace hint from query (e.g., "@frontend:/filename")
						let workspaceHint: string | undefined
						let searchQuery = query
						const workspaceHintMatch = query.match(/^([\w-]+):\/(.*)$/)
						if (workspaceHintMatch) {
							workspaceHint = workspaceHintMatch[1]
							searchQuery = workspaceHintMatch[2]
						}

						// Set a timeout to debounce the search requests
						searchTimeoutRef.current = setTimeout(() => {
							const myToken = ++latestSearchTokenRef.current
							FileServiceClient.searchFiles(
								FileSearchRequest.create({
									query: searchQuery,
									mentionsRequestId: String(myToken),
									selectedType: searchType,
									workspaceHint: workspaceHint,
								}),
							)
								.then((results) => {
									if (myToken !== latestSearchTokenRef.current) {
										// Stale response — a newer search has been issued.
										return
									}
									setFileSearchResults((results.results || []) as SearchResult[])
									setSearchLoading(false)
								})
								.catch((error) => {
									if (myToken !== latestSearchTokenRef.current) {
										return
									}
									console.error("Error searching files:", error)
									setFileSearchResults([])
									setSearchLoading(false)
								})
						}, 200) // 200ms debounce
					} else {
						setSelectedMenuIndex(DEFAULT_CONTEXT_MENU_OPTION)
					}
				} else {
					setSearchQuery("")
					setSelectedMenuIndex(-1)
					setFileSearchResults([])
				}
			},
			[setInputValue, setFileSearchResults, selectedType],
		)

		useEffect(() => {
			if (!showContextMenu) {
				setSelectedType(null)
			}
		}, [showContextMenu])

		const handleBlur = useCallback(() => {
			// Only hide the context menu if the user didn't click on it
			if (!isMouseDownOnMenu) {
				setShowContextMenu(false)
				setShowSlashCommandsMenu(false)
			}
			setIsTextAreaFocused(false)
			onFocusChange?.(false) // Call prop on blur
		}, [isMouseDownOnMenu, onFocusChange])

		const showDimensionErrorMessage = useCallback(() => {
			setShowDimensionError(true)
			if (dimensionErrorTimerRef.current) {
				clearTimeout(dimensionErrorTimerRef.current)
			}
			dimensionErrorTimerRef.current = setTimeout(() => {
				setShowDimensionError(false)
				dimensionErrorTimerRef.current = null
			}, 3000)
		}, [])

		const handlePaste = useCallback(
			async (e: React.ClipboardEvent) => {
				const items = e.clipboardData.items

				const pastedText = e.clipboardData.getData("text")
				// Check if the pasted content is a URL, add space after so user can easily delete if they don't want it
				const urlRegex = /^\S+:\/\/\S+$/
				if (urlRegex.test(pastedText.trim())) {
					e.preventDefault()
					const trimmedUrl = pastedText.trim()
					const newValue = inputValue.slice(0, cursorPosition) + trimmedUrl + " " + inputValue.slice(cursorPosition)
					setInputValue(newValue)
					const newCursorPosition = cursorPosition + trimmedUrl.length + 1
					setCursorPosition(newCursorPosition)
					setIntendedCursorPosition(newCursorPosition)
					setShowContextMenu(false)

					// Scroll to new cursor position
					// https://stackoverflow.com/questions/29899364/how-do-you-scroll-to-the-position-of-the-cursor-in-a-textarea/40951875#40951875
					setTimeout(() => {
						if (textAreaRef.current) {
							textAreaRef.current.blur()
							textAreaRef.current.focus()
						}
					}, 0)
					// NOTE: callbacks dont utilize return function to cleanup, but it's fine since this timeout immediately executes and will be cleaned up by the browser (no chance component unmounts before it executes)

					return
				}

				const acceptedTypes = ["png", "jpeg", "webp"] // supported by anthropic and openrouter (jpg is just a file extension but the image will be recognized as jpeg)
				const imageItems = Array.from(items).filter((item) => {
					const [type, subtype] = item.type.split("/")
					return type === "image" && acceptedTypes.includes(subtype)
				})
				if (!shouldDisableFilesAndImages && imageItems.length > 0) {
					e.preventDefault()
					const imagePromises = imageItems.map((item) => {
						return new Promise<string | null>((resolve) => {
							const blob = item.getAsFile()
							if (!blob) {
								resolve(null)
								return
							}
							const reader = new FileReader()
							reader.onloadend = async () => {
								if (reader.error) {
									console.error("Error reading file:", reader.error)
									resolve(null)
								} else {
									const result = reader.result
									if (typeof result === "string") {
										try {
											await getImageDimensions(result)
											resolve(result)
										} catch (error) {
											console.warn((error as Error).message)
											showDimensionErrorMessage()
											resolve(null)
										}
									} else {
										resolve(null)
									}
								}
							}
							reader.readAsDataURL(blob)
						})
					})
					const imageDataArray = await Promise.all(imagePromises)
					const dataUrls = imageDataArray.filter((dataUrl): dataUrl is string => dataUrl !== null)
					//.map((dataUrl) => dataUrl.split(",")[1]) // strip the mime type prefix, sharp doesn't need it
					if (dataUrls.length > 0) {
						const filesAndImagesLength = selectedImages.length + selectedFiles.length
						const availableSlots = MAX_IMAGES_AND_FILES_PER_MESSAGE - filesAndImagesLength

						if (availableSlots > 0) {
							const imagesToAdd = Math.min(dataUrls.length, availableSlots)
							setSelectedImages((prevImages) => [...prevImages, ...dataUrls.slice(0, imagesToAdd)])
						}
					} else {
						console.warn("No valid images were processed")
					}
				}
			},
			[
				shouldDisableFilesAndImages,
				setSelectedImages,
				selectedImages,
				selectedFiles,
				cursorPosition,
				setInputValue,
				inputValue,
				showDimensionErrorMessage,
			],
		)

		const handleThumbnailsHeightChange = useCallback((height: number) => {
			setThumbnailsHeight(height)
		}, [])

		useEffect(() => {
			if (selectedImages.length === 0 && selectedFiles.length === 0) {
				setThumbnailsHeight(0)
			}
		}, [selectedImages, selectedFiles])

		const handleMenuMouseDown = useCallback(() => {
			setIsMouseDownOnMenu(true)
		}, [])

		const updateHighlights = useCallback(() => {
			if (!textAreaRef.current || !highlightLayerRef.current) {
				return
			}

			let processedText = textAreaRef.current.value

			processedText = processedText
				.replace(/\n$/, "\n\n")
				.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c] || c)
				// highlight @mentions
				.replace(mentionRegexGlobal, '<mark class="mention-context-textarea-highlight">$&</mark>')

			// Highlight only the FIRST valid /slash-command in the text
			// Only one slash command is processed per message, so we only highlight the first one
			slashCommandRegexGlobal.lastIndex = 0
			let hasHighlightedSlashCommand = false
			processedText = processedText.replace(slashCommandRegexGlobal, (match, prefix, command) => {
				// Only highlight the first valid slash command
				if (hasHighlightedSlashCommand) {
					return match
				}

				// Extract just the command name (without the slash)
				const commandName = command.substring(1)
				const isValidCommand = validateSlashCommand(
					commandName,
					localWorkflowToggles,
					globalWorkflowToggles,
					remoteWorkflowToggles,
					remoteConfigSettings?.remoteGlobalWorkflows,
				)

				if (isValidCommand) {
					hasHighlightedSlashCommand = true
					// Keep the prefix (whitespace or empty) and wrap the command in highlight
					return `${prefix}<mark class="mention-context-textarea-highlight">${command}</mark>`
				}
				return match
			})

			highlightLayerRef.current.innerHTML = processedText
			highlightLayerRef.current.scrollTop = textAreaRef.current.scrollTop
			highlightLayerRef.current.scrollLeft = textAreaRef.current.scrollLeft
		}, [localWorkflowToggles, globalWorkflowToggles, remoteWorkflowToggles, remoteConfigSettings])

		useLayoutEffect(() => {
			updateHighlights()
		}, [inputValue, updateHighlights])

		const updateCursorPosition = useCallback(() => {
			if (textAreaRef.current) {
				setCursorPosition(textAreaRef.current.selectionStart)
			}
		}, [])

		const handleKeyUp = useCallback(
			(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
				if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) {
					updateCursorPosition()
				}
			},
			[updateCursorPosition],
		)

		const onModeToggle = useCallback(() => {
			void (async () => {
				const convertedProtoMode = mode === "plan" ? PlanActMode.ACT : PlanActMode.PLAN
				const submittedText = inputValue
				const submittedImages = selectedImages
				const submittedFiles = selectedFiles
				const response = await StateServiceClient.togglePlanActModeProto(
					TogglePlanActModeRequest.create({
						mode: convertedProtoMode,
						chatContent: {
							message: submittedText.trim() ? submittedText : undefined,
							images: submittedImages,
							files: submittedFiles,
						},
					}),
				)
				// Focus the textarea after mode toggle with slight delay
				setTimeout(() => {
					const consumedComposerContent = response.value === true
					const currentText = textAreaRef.current?.value ?? ""
					// Reconcile only the submitted draft: the rebuild can take a moment
					// and the user may have typed new content in the meantime.
					const draftAction = getModeToggleDraftAction({
						consumed: consumedComposerContent,
						currentText,
						submittedText,
					})

					switch (draftAction) {
						case "clear":
							setInputValue("")
							break
						case "restore":
							setInputValue(submittedText)
							break
						case "keep":
							break
					}

					if (consumedComposerContent) {
						setSelectedImages((current) => (current === submittedImages ? [] : current))
						setSelectedFiles((current) => (current === submittedFiles ? [] : current))
					} else {
						if (submittedImages.length > 0) {
							setSelectedImages((current) => (current.length === 0 ? submittedImages : current))
						}
						if (submittedFiles.length > 0) {
							setSelectedFiles((current) => (current.length === 0 ? submittedFiles : current))
						}
					}
					textAreaRef.current?.focus()
				}, 100)
			})()
		}, [mode, inputValue, selectedImages, selectedFiles, setInputValue, setSelectedImages, setSelectedFiles])

		useShortcut(usePlatform().togglePlanActKeys, onModeToggle, { disableTextInputs: false }) // important that we don't disable the text input here

		const handleContextButtonClick = useCallback(() => {
			// Focus the textarea first
			textAreaRef.current?.focus()

			// If input is empty, just insert @
			if (!inputValue.trim()) {
				const event = {
					target: {
						value: "@",
						selectionStart: 1,
					},
				} as React.ChangeEvent<HTMLTextAreaElement>
				handleInputChange(event)
				updateHighlights()
				return
			}

			// If input ends with space or is empty, just append @
			if (inputValue.endsWith(" ")) {
				const event = {
					target: {
						value: inputValue + "@",
						selectionStart: inputValue.length + 1,
					},
				} as React.ChangeEvent<HTMLTextAreaElement>
				handleInputChange(event)
				updateHighlights()
				return
			}

			// Otherwise add space then @
			const event = {
				target: {
					value: inputValue + " @",
					selectionStart: inputValue.length + 2,
				},
			} as React.ChangeEvent<HTMLTextAreaElement>
			handleInputChange(event)
			updateHighlights()
		}, [inputValue, handleInputChange, updateHighlights])

		const handleModelButtonClick = () => {
			navigateToSettingsModelPicker({ targetSection: "api-config" })
		}

		const [ollamaModels, setOllamaModels] = useState<string[]>([])
		const [isRefreshingOllama, setIsRefreshingOllama] = useState(false)
		const [ollamaStatus, setOllamaStatus] = useState<{
			isRunning: boolean
			modelName: string
			size: number
			sizeVram: number
			gpuPercent: number
			cpuPercent: number
		}>({
			isRunning: false,
			modelName: "",
			size: 0,
			sizeVram: 0,
			gpuPercent: 100,
			cpuPercent: 0,
		})
		const [isUnloadingOllama, setIsUnloadingOllama] = useState(false)
		const ollamaBaseUrl = apiConfiguration?.ollamaBaseUrl

		const requestOllamaStatus = useCallback(async () => {
			if (selectedProvider !== "ollama") return
			try {
				const res = await ModelsServiceClient.getOllamaModelStatus(
					StringRequest.create({
						value: ollamaBaseUrl || "",
					}),
				)
				if (res) {
					setOllamaStatus({
						isRunning: res.isRunning,
						modelName: res.modelName,
						size: res.size,
						sizeVram: res.sizeVram,
						gpuPercent: res.gpuPercent,
						cpuPercent: res.cpuPercent,
					})
				}
			} catch (error) {
				console.error("Failed to fetch Ollama model status in ChatTextArea:", error)
			}
		}, [selectedProvider, ollamaBaseUrl])

		const handleUnloadOllamaModel = useCallback(async () => {
			if (selectedProvider !== "ollama") return
			setIsUnloadingOllama(true)
			try {
				await ModelsServiceClient.unloadOllamaModel(
					UnloadOllamaModelRequest.create({
						baseUrl: ollamaBaseUrl || "",
						modelName: ollamaStatus.modelName || selectedModelId || "",
					}),
				)
				await requestOllamaStatus()
			} catch (error) {
				console.error("Failed to unload Ollama model in ChatTextArea:", error)
			} finally {
				setIsUnloadingOllama(false)
			}
		}, [selectedProvider, ollamaBaseUrl, ollamaStatus.modelName, selectedModelId, requestOllamaStatus])

		useEffect(() => {
			if (selectedProvider === "ollama") {
				requestOllamaStatus()
				const interval = setInterval(requestOllamaStatus, 5000)
				return () => clearInterval(interval)
			}
		}, [selectedProvider, requestOllamaStatus])

		const requestOllamaModels = useCallback(async () => {
			if (selectedProvider !== "ollama") return
			setIsRefreshingOllama(true)
			try {
				const response = await ModelsServiceClient.getOllamaModels(
					StringRequest.create({
						value: ollamaBaseUrl || "",
					}),
				)
				if (response?.values) {
					setOllamaModels(response.values)
				}
				void requestOllamaStatus()
			} catch (error) {
				console.error("Failed to fetch Ollama models in ChatTextArea:", error)
			} finally {
				setIsRefreshingOllama(false)
			}
		}, [selectedProvider, ollamaBaseUrl, requestOllamaStatus])

		useEffect(() => {
			if (selectedProvider === "ollama") {
				requestOllamaModels()
			}
		}, [selectedProvider, requestOllamaModels])

		// Context Size Slider state & sync
		const contextWindowFromModel = selectedModelInfo?.contextWindow
		const ollamaCtx = Number.parseInt(apiConfiguration?.ollamaApiOptionsCtxNum || "", 10)
		const effectiveContextSize =
			Number.isFinite(contextWindowFromModel) && (contextWindowFromModel ?? 0) > 0
				? (contextWindowFromModel as number)
				: Number.isFinite(ollamaCtx) && ollamaCtx > 0
					? ollamaCtx
					: 32768

		const [contextSize, setContextSize] = useState<number>(effectiveContextSize)

		useEffect(() => {
			if (effectiveContextSize && effectiveContextSize > 0) {
				setContextSize(effectiveContextSize)
			}
		}, [effectiveContextSize])

		// Temperature state & sync
		const modelTemp = selectedModelInfo?.temperature
		const [temperature, setTemperature] = useState<number>(
			typeof modelTemp === "number" && Number.isFinite(modelTemp) ? modelTemp : 0.8,
		)

		useEffect(() => {
			if (typeof modelTemp === "number" && Number.isFinite(modelTemp)) {
				setTemperature(modelTemp)
			}
		}, [modelTemp])

		const handleTemperatureSelect = useCallback(
			async (newTemp: number) => {
				const clamped = Math.max(0, Math.min(1, Math.round(newTemp * 10) / 10))
				setTemperature(clamped)
				if (!selectedModelId) return
				try {
					await ModelsServiceClient.commitModelSelection(
						CommitModelSelectionRequest.create({
							providerId: selectedProvider,
							mode,
							modelId: selectedModelId,
							overrides: toProtobufModelOverrides({
								contextWindow: contextSize,
								temperature: clamped,
							}),
						}),
					)
				} catch (error) {
					console.error("Failed to commit temperature override:", error)
				}
			},
			[selectedProvider, mode, selectedModelId, contextSize],
		)

		const handleTemperatureStep = useCallback(
			(step: number) => {
				const next = Math.round((temperature + step) * 10) / 10
				void handleTemperatureSelect(next)
			},
			[temperature, handleTemperatureSelect],
		)

		const handleOllamaModelSelect = useCallback(
			async (newModelId: string) => {
				if (!newModelId) return
				try {
					await ModelsServiceClient.commitModelSelection(
						CommitModelSelectionRequest.create({
							providerId: "ollama",
							mode,
							modelId: newModelId,
							overrides: toProtobufModelOverrides({
								contextWindow: contextSize,
								temperature,
							}),
						}),
					)
				} catch (error) {
					console.error("Failed to commit Ollama model selection:", error)
				}
			},
			[mode, contextSize, temperature],
		)

		const sliderIndex = useMemo(() => {
			let closest = 0
			let minDiff = Infinity
			CONTEXT_SIZES.forEach((size, idx) => {
				const diff = Math.abs(size - (contextSize || 32768))
				if (diff < minDiff) {
					minDiff = diff
					closest = idx
				}
			})
			return closest
		}, [contextSize])

		const handleContextSizeChange = useCallback(
			async (newIndex: number) => {
				const newSize = CONTEXT_SIZES[newIndex]
				setContextSize(newSize)

				if (selectedProvider === "ollama") {
					try {
						await ModelsServiceClient.writeProviderConfig(
							WriteProviderConfigRequest.create({
								providerId: "ollama",
								patch: WriteProviderConfigPatch.create({
									contextWindow: newSize,
								}),
							}),
						)
					} catch (error) {
						console.error("Failed to update Ollama context window config:", error)
					}
				}

				if (selectedModelId) {
					try {
						await ModelsServiceClient.commitModelSelection(
							CommitModelSelectionRequest.create({
								providerId: selectedProvider,
								mode,
								modelId: selectedModelId,
								overrides: toProtobufModelOverrides({
									contextWindow: newSize,
									temperature,
								}),
							}),
						)
					} catch (error) {
						console.error("Failed to commit model context window override:", error)
					}
				}
			},
			[selectedProvider, selectedModelId, mode, temperature],
		)

		// Get model display name
		const modelDisplayName = useMemo(() => {
			if (!didHydrateState) {
				return "Loading model..."
			}
			const {
				vsCodeLmModelSelector,
				togetherModelId,
				lmStudioModelId,
				ollamaModelId,
				liteLlmModelId,
				requestyModelId,
				vercelAiGatewayModelId,
			} = getModeSpecificFields(apiConfiguration, mode)
			const unknownModel = "unknown"

			if (!apiConfiguration) {
				return unknownModel
			}
			switch (selectedProvider) {
				case "cline":
					return `${selectedProvider}:${selectedModelId || "..."}`
				case "cline-pass":
					// Free models selected on ClinePass go through Cline usage billing,
					// so label them the same way as the cline provider
					return selectedModelId.startsWith("cline-pass/")
						? `${selectedProvider}:${selectedModelId.replace(/^cline-pass\//, "")}`
						: `cline:${selectedModelId || "..."}`
				case "openai":
					return `openai-compat:${selectedModelId || "..."}`
				case "vscode-lm":
					return `vscode-lm:${vsCodeLmModelSelector ? `${vsCodeLmModelSelector.vendor ?? ""}/${vsCodeLmModelSelector.family ?? ""}` : unknownModel}`
				case "together":
					return `${selectedProvider}:${togetherModelId || "..."}`
				case "lmstudio":
					return `${selectedProvider}:${lmStudioModelId || "..."}`
				case "ollama":
					return `${selectedProvider}:${ollamaModelId || "..."}`
				case "litellm":
					return `${selectedProvider}:${liteLlmModelId || "..."}`
				case "requesty":
					return `${selectedProvider}:${requestyModelId || "..."}`
				case "vercel-ai-gateway":
					return `${selectedProvider}:${vercelAiGatewayModelId || selectedModelId || "..."}`
				case "anthropic":
				case "openrouter":
				default:
					return `${selectedProvider || "model"}:${selectedModelId || "..."}`
			}
		}, [apiConfiguration, mode, selectedProvider, selectedModelId, didHydrateState])

		// Function to show error message for unsupported files for drag and drop
		const showUnsupportedFileErrorMessage = () => {
			// Show error message for unsupported files
			setShowUnsupportedFileError(true)

			// Clear any existing timer
			if (unsupportedFileTimerRef.current) {
				clearTimeout(unsupportedFileTimerRef.current)
			}

			// Set timer to hide error after 3 seconds
			unsupportedFileTimerRef.current = setTimeout(() => {
				setShowUnsupportedFileError(false)
				unsupportedFileTimerRef.current = null
			}, 3000)
		}

		const handleDragEnter = (e: React.DragEvent) => {
			e.preventDefault()
			setIsDraggingOver(true)

			// Check if files are being dragged
			if (e.dataTransfer.types.includes("Files")) {
				// Check if any of the files are not images
				const items = Array.from(e.dataTransfer.items)
				const hasNonImageFile = items.some((item) => {
					if (item.kind === "file") {
						const type = item.type.split("/")[0]
						return type !== "image"
					}
					return false
				})

				if (hasNonImageFile) {
					showUnsupportedFileErrorMessage()
				}
			}
		}
		/**
		 * Handles the drag over event to allow dropping.
		 * Prevents the default behavior to enable drop.
		 *
		 * @param {React.DragEvent} e - The drag event.
		 */
		const onDragOver = (e: React.DragEvent) => {
			e.preventDefault()
			// Ensure state remains true if dragging continues over the element
			if (!isDraggingOver) {
				setIsDraggingOver(true)
			}
		}

		const handleDragLeave = (e: React.DragEvent) => {
			e.preventDefault()
			// Check if the related target is still within the drop zone; prevents flickering
			const dropZone = e.currentTarget as HTMLElement
			if (!dropZone.contains(e.relatedTarget as Node)) {
				setIsDraggingOver(false)
				// Don't clear the error message here, let it time out naturally
			}
		}

		// Effect to detect when drag operation ends outside the component
		useEffect(() => {
			const handleGlobalDragEnd = () => {
				// This will be triggered when the drag operation ends anywhere
				setIsDraggingOver(false)
				// Don't clear error message, let it time out naturally
			}

			document.addEventListener("dragend", handleGlobalDragEnd)

			return () => {
				document.removeEventListener("dragend", handleGlobalDragEnd)
			}
		}, [])

		/**
		 * Handles the drop event for files and text.
		 * Processes dropped images and text, updating the state accordingly.
		 *
		 * @param {React.DragEvent} e - The drop event.
		 */
		const onDrop = async (e: React.DragEvent) => {
			e.preventDefault()
			setIsDraggingOver(false) // Reset state on drop

			// Clear any error message when something is actually dropped
			setShowUnsupportedFileError(false)
			if (unsupportedFileTimerRef.current) {
				clearTimeout(unsupportedFileTimerRef.current)
				unsupportedFileTimerRef.current = null
			}

			// --- 1. VSCode Explorer Drop Handling ---
			let uris: string[] = []
			const resourceUrlsData = e.dataTransfer.getData("resourceurls")
			const vscodeUriListData = e.dataTransfer.getData("application/vnd.code.uri-list")

			// 1a. Try 'resourceurls' first (used for multi-select)
			if (resourceUrlsData) {
				try {
					uris = JSON.parse(resourceUrlsData)
					uris = uris.map((uri) => decodeURIComponent(uri))
				} catch (error) {
					console.error("Failed to parse resourceurls JSON:", error)
					uris = [] // Reset if parsing failed
				}
			}

			// 1b. Fallback to 'application/vnd.code.uri-list' (newline separated)
			if (uris.length === 0 && vscodeUriListData) {
				uris = vscodeUriListData.split("\n").map((uri) => uri.trim())
			}

			// 1c. Filter for valid schemes (file or vscode-file) and non-empty strings
			const validUris = uris.filter(
				(uri) => uri && (uri.startsWith("vscode-file:") || uri.startsWith("file:") || uri.startsWith("vscode-remote:")),
			)

			if (validUris.length > 0) {
				setPendingInsertions([])
				let initialCursorPos = inputValue.length
				if (textAreaRef.current) {
					initialCursorPos = textAreaRef.current.selectionStart
				}
				setIntendedCursorPosition(initialCursorPos)

				FileServiceClient.getRelativePaths(RelativePathsRequest.create({ uris: validUris }))
					.then((response) => {
						if (response.paths.length > 0) {
							setPendingInsertions((prev) => [...prev, ...response.paths])
						}
					})
					.catch((error) => {
						console.error("Error getting relative paths:", error)
					})
				return
			}

			const text = e.dataTransfer.getData("text")
			if (text) {
				handleTextDrop(text)
				return
			}

			// --- 3. Image Drop Handling ---
			// Only proceed if it wasn't a VSCode resource or plain text drop
			const files = Array.from(e.dataTransfer.files)
			const acceptedTypes = ["png", "jpeg", "webp"]
			const imageFiles = files.filter((file) => {
				const [type, subtype] = file.type.split("/")
				return type === "image" && acceptedTypes.includes(subtype)
			})

			if (shouldDisableFilesAndImages || imageFiles.length === 0) {
				return
			}

			const imageDataArray = await readImageFiles(imageFiles)
			const dataUrls = imageDataArray.filter((dataUrl): dataUrl is string => dataUrl !== null)

			if (dataUrls.length > 0) {
				const filesAndImagesLength = selectedImages.length + selectedFiles.length
				const availableSlots = MAX_IMAGES_AND_FILES_PER_MESSAGE - filesAndImagesLength

				if (availableSlots > 0) {
					const imagesToAdd = Math.min(dataUrls.length, availableSlots)
					setSelectedImages((prevImages) => [...prevImages, ...dataUrls.slice(0, imagesToAdd)])
				}
			} else {
				console.warn("No valid images were processed")
			}
		}

		/**
		 * Handles the drop event for text.
		 * Inserts the dropped text at the current cursor position.
		 *
		 * @param {string} text - The dropped text.
		 */
		const handleTextDrop = (text: string) => {
			const newValue = inputValue.slice(0, cursorPosition) + text + inputValue.slice(cursorPosition)
			setInputValue(newValue)
			const newCursorPosition = cursorPosition + text.length
			setCursorPosition(newCursorPosition)
			setIntendedCursorPosition(newCursorPosition)
		}

		/**
		 * Reads image files and returns their data URLs.
		 * Uses FileReader to read the files as data URLs.
		 *
		 * @param {File[]} imageFiles - The image files to read.
		 * @returns {Promise<(string | null)[]>} - A promise that resolves to an array of data URLs or null values.
		 */
		const readImageFiles = (imageFiles: File[]): Promise<(string | null)[]> => {
			return Promise.all(
				imageFiles.map(
					(file) =>
						new Promise<string | null>((resolve) => {
							const reader = new FileReader()
							reader.onloadend = async () => {
								// Make async
								if (reader.error) {
									console.error("Error reading file:", reader.error)
									resolve(null)
								} else {
									const result = reader.result
									if (typeof result === "string") {
										try {
											await getImageDimensions(result) // Check dimensions
											resolve(result)
										} catch (error) {
											console.warn((error as Error).message)
											showDimensionErrorMessage() // Show error to user
											resolve(null) // Don't add this image
										}
									} else {
										resolve(null)
									}
								}
							}
							reader.readAsDataURL(file)
						}),
				),
			)
		}
		// Replace Meta with the platform specific key and uppercase the command letter.
		const togglePlanActKeys = usePlatform()
			.togglePlanActKeys.replace("Meta", metaKeyChar)
			.replace(/.$/, (match) => match.toUpperCase())

		return (
			<div>
				<div
					className="relative flex transition-colors ease-in-out duration-100 px-3.5 py-2.5"
					onDragEnter={handleDragEnter}
					onDragLeave={handleDragLeave}
					onDragOver={onDragOver}
					onDrop={onDrop}>
					{showDimensionError && (
						<div className="absolute inset-2.5 bg-[rgba(var(--vscode-errorForeground-rgb),0.1)] border-2 border-error rounded-xs flex items-center justify-center z-10 pointer-events-none">
							<span className="text-error font-bold text-xs text-center">Image dimensions exceed 7500px</span>
						</div>
					)}
					{showUnsupportedFileError && (
						<div className="absolute inset-2.5 bg-[rgba(var(--vscode-errorForeground-rgb),0.1)] border-2 border-error rounded-xs flex items-center justify-center z-10 pointer-events-none">
							<span className="text-error font-bold text-xs">Files other than images are currently disabled</span>
						</div>
					)}
					{showSlashCommandsMenu && (
						<div ref={slashCommandsMenuContainerRef}>
							<SlashCommandMenu
								globalWorkflowToggles={globalWorkflowToggles}
								localWorkflowToggles={localWorkflowToggles}
								mcpServers={mcpServers}
								onMouseDown={handleMenuMouseDown}
								onSelect={handleSlashCommandsSelect}
								query={slashCommandsQuery}
								remoteWorkflows={remoteConfigSettings?.remoteGlobalWorkflows}
								remoteWorkflowToggles={remoteWorkflowToggles}
								selectedIndex={selectedSlashCommandsIndex}
								setSelectedIndex={setSelectedSlashCommandsIndex}
							/>
						</div>
					)}

					{showContextMenu && (
						<div ref={contextMenuContainerRef}>
							<ContextMenu
								dynamicSearchResults={fileSearchResults}
								isLoading={searchLoading}
								onMouseDown={handleMenuMouseDown}
								onSelect={handleMentionSelect}
								queryItems={queryItems}
								searchQuery={searchQuery}
								selectedIndex={selectedMenuIndex}
								selectedType={selectedType}
								setSelectedIndex={setSelectedMenuIndex}
							/>
						</div>
					)}
					<div
						className={cn(
							"absolute bottom-2.5 top-2.5 whitespace-pre-wrap break-words rounded-xs overflow-hidden bg-input-background",
							isTextAreaFocused ? "left-3.5 right-3.5" : "left-3.5 right-3.5 border border-input-border",
						)}
						ref={highlightLayerRef}
						style={{
							position: "absolute",
							pointerEvents: "none",
							whiteSpace: "pre-wrap",
							wordWrap: "break-word",
							color: "transparent",
							overflow: "hidden",
							fontFamily: "var(--vscode-font-family)",
							fontSize: "var(--vscode-editor-font-size)",
							lineHeight: "var(--vscode-editor-line-height)",
							borderRadius: 2,
							borderLeft: isTextAreaFocused ? 0 : undefined,
							borderRight: isTextAreaFocused ? 0 : undefined,
							borderTop: isTextAreaFocused ? 0 : undefined,
							borderBottom: isTextAreaFocused ? 0 : undefined,
							padding: `9px 28px ${9 + thumbnailsHeight}px 9px`,
						}}
					/>
					<DynamicTextArea
						autoFocus={true}
						data-testid="chat-input"
						maxRows={10}
						minRows={3}
						onBlur={handleBlur}
						onChange={(e) => {
							handleInputChange(e)
							updateHighlights()
						}}
						onFocus={() => {
							setIsTextAreaFocused(true)
							onFocusChange?.(true) // Call prop on focus
						}}
						onHeightChange={(height) => {
							if (textAreaBaseHeight === undefined || height < textAreaBaseHeight) {
								setTextAreaBaseHeight(height)
							}
							onHeightChange?.(height)
						}}
						onKeyDown={handleKeyDown}
						onKeyUp={handleKeyUp}
						onMouseUp={updateCursorPosition}
						onPaste={handlePaste}
						onScroll={() => updateHighlights()}
						onSelect={updateCursorPosition}
						placeholder={showUnsupportedFileError || showDimensionError ? "" : placeholderText}
						ref={(el) => {
							if (typeof ref === "function") {
								ref(el)
							} else if (ref) {
								ref.current = el
							}
							textAreaRef.current = el
						}}
						style={{
							width: "100%",
							boxSizing: "border-box",
							backgroundColor: "transparent",
							color: "var(--vscode-input-foreground)",
							//border: "1px solid var(--vscode-input-border)",
							borderRadius: 2,
							fontFamily: "var(--vscode-font-family)",
							fontSize: "var(--vscode-editor-font-size)",
							lineHeight: "var(--vscode-editor-line-height)",
							resize: "none",
							overflowX: "hidden",
							overflowY: "scroll",
							scrollbarWidth: "none",
							// Since we have maxRows, when text is long enough it starts to overflow the bottom padding, appearing behind the thumbnails. To fix this, we use a transparent border to push the text up instead. (https://stackoverflow.com/questions/42631947/maintaining-a-padding-inside-of-text-area/52538410#52538410)
							// borderTop: "9px solid transparent",
							borderLeft: 0,
							borderRight: 0,
							borderTop: 0,
							borderBottom: `${thumbnailsHeight}px solid transparent`,
							borderColor: "transparent",
							// borderRight: "54px solid transparent",
							// borderLeft: "9px solid transparent", // NOTE: react-textarea-autosize doesn't calculate correct height when using borderLeft/borderRight so we need to use horizontal padding instead
							// Instead of using boxShadow, we use a div with a border to better replicate the behavior when the textarea is focused
							// boxShadow: "0px 0px 0px 1px var(--vscode-input-border)",
							padding: "9px 28px 9px 9px",
							cursor: "text",
							flex: 1,
							zIndex: 1,
							outline:
								isDraggingOver && !showUnsupportedFileError // Only show drag outline if not showing error
									? "2px dashed var(--vscode-focusBorder)"
									: isTextAreaFocused
										? `1px solid ${mode === "plan" ? PLAN_MODE_COLOR : "var(--vscode-focusBorder)"}`
										: "none",
							outlineOffset: isDraggingOver && !showUnsupportedFileError ? "1px" : "0px", // Add offset for drag-over outline
						}}
						value={inputValue}
					/>
					{!inputValue && selectedImages.length === 0 && selectedFiles.length === 0 && (
						<div className="text-xs absolute bottom-5 left-6.5 right-16 text-(--vscode-input-placeholderForeground)/50 whitespace-nowrap overflow-hidden text-ellipsis pointer-events-none z-1">
							Type @ for context, / for slash commands & workflows, hold shift to drag in files/images
						</div>
					)}
					{(selectedImages.length > 0 || selectedFiles.length > 0) && (
						<Thumbnails
							files={selectedFiles}
							images={selectedImages}
							imagesUnsupported={unsupportedImagesAttached}
							onHeightChange={handleThumbnailsHeightChange}
							setFiles={setSelectedFiles}
							setImages={setSelectedImages}
							style={{
								position: "absolute",
								paddingTop: 4,
								bottom: 14,
								left: 22,
								right: 47, // (54 + 9) + 4 extra padding
								zIndex: 2,
							}}
						/>
					)}
					<div
						className="absolute flex items-end bottom-4.5 right-5 z-10 h-8 text-xs"
						style={{ height: textAreaBaseHeight }}>
						<div className="flex flex-row items-center">
							<div
								className={cn("input-icon-button", { disabled: sendingDisabled }, "codicon codicon-send text-sm")}
								data-testid="send-button"
								onClick={() => {
									if (!sendingDisabled) {
										onSend()
									}
								}}
							/>
						</div>
					</div>
				</div>
				{unsupportedImagesAttached && (
					<div
						className="flex items-center gap-1.5 px-3.5 pb-1.5 text-xs"
						data-testid="images-unsupported-notice"
						role="status"
						style={{ color: "var(--vscode-editorWarning-foreground)" }}>
						<TriangleAlertIcon className="shrink-0" size={12} />
						<span className="min-w-0">
							{selectedModelId} doesn't support images, so{" "}
							{selectedImages.length === 1 ? "the attached image" : `the ${selectedImages.length} attached images`}{" "}
							will be ignored.{" "}
							<button
								className="underline cursor-pointer bg-transparent border-0 p-0 m-0 text-[var(--vscode-textLink-foreground)] hover:text-[var(--vscode-textLink-activeForeground)]"
								data-testid="images-unsupported-choose-model"
								onClick={handleModelButtonClick}
								type="button">
								Choose an image-capable model
							</button>{" "}
							or remove {selectedImages.length === 1 ? "it" : "them"}.
						</span>
					</div>
				)}
				<div className="flex items-center gap-2 px-3 pb-1.5 pt-0.5 text-xs">
					{selectedProvider === "ollama" && (
						<div className="flex items-center gap-1 shrink-0">
							<div
								className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono select-none text-white transition-colors"
								data-testid="gpu-cpu-ratio"
								style={{
									backgroundColor:
										(ollamaStatus.isRunning ? ollamaStatus.gpuPercent : 100) >= 100
											? "#223b2d"
											: (ollamaStatus.isRunning ? ollamaStatus.gpuPercent : 100) <= 0
												? "#522b2b"
												: "#544120",
								}}
								title={
									ollamaStatus.isRunning
										? `Ollama Active Model: ${ollamaStatus.modelName || selectedModelId}\nVRAM: ${(Number(ollamaStatus.sizeVram) / (1024 * 1024 * 1024)).toFixed(2)} GB / ${(Number(ollamaStatus.size) / (1024 * 1024 * 1024)).toFixed(2)} GB`
										: "Ollama: Idle (loads into memory on generation)"
								}>
								<CpuIcon size={11} />
								<span>
									{ollamaStatus.isRunning
										? `${ollamaStatus.gpuPercent}% GPU / ${ollamaStatus.cpuPercent}% CPU`
										: "100% GPU"}
								</span>
							</div>
							<button
								type="button"
								onClick={handleUnloadOllamaModel}
								disabled={isUnloadingOllama || (!ollamaStatus.isRunning && !ollamaStatus.modelName)}
								className="flex items-center justify-center p-1 rounded bg-[var(--vscode-button-secondaryBackground)] hover:bg-[var(--vscode-button-secondaryHoverBackground)] text-[var(--vscode-button-secondaryForeground)] cursor-pointer transition-colors border-0 select-none disabled:opacity-40 disabled:cursor-not-allowed"
								aria-label="Free VRAM"
								title={
									ollamaStatus.isRunning
										? `Unload ${ollamaStatus.modelName || selectedModelId} and free VRAM (${(Number(ollamaStatus.sizeVram) / (1024 * 1024 * 1024)).toFixed(2)} GB)`
										: "No model currently loaded in VRAM"
								}
								data-testid="unload-ollama-model-button">
								<PowerOffIcon size={11} className={isUnloadingOllama ? "animate-spin" : ""} />
							</button>
						</div>
					)}
					<div
						className="flex items-center shrink-0 text-[var(--vscode-descriptionForeground)] select-none cursor-help"
						title={`Context: ${CONTEXT_SIZES[sliderIndex].toLocaleString()} tokens`}>
						<DatabaseIcon size={12} />
					</div>
					<div className="flex-1 min-w-0 flex items-center gap-2">
						<ContextSlider
							aria-label="Context"
							aria-valuetext={`${CONTEXT_SIZES[sliderIndex].toLocaleString()} tokens (${formatContextSizeLabel(CONTEXT_SIZES[sliderIndex])})`}
							className="flex-1 cursor-pointer"
							data-testid="context-size-slider"
							max={CONTEXT_SIZES.length - 1}
							min={0}
							onValueChange={(val: number[]) => handleContextSizeChange(val[0])}
							step={1}
							value={[sliderIndex]}
						/>
						<span
							className="text-[11px] font-mono text-[var(--vscode-foreground)] shrink-0 min-w-[36px] text-right select-none"
							data-testid="context-size-value"
							title={`${CONTEXT_SIZES[sliderIndex].toLocaleString()} tokens`}>
							{formatContextSizeLabel(CONTEXT_SIZES[sliderIndex])}
						</span>
						{selectedProvider === "ollama" && (
							<div
								className="flex items-center rounded border border-[var(--vscode-input-border)] bg-[var(--vscode-input-background)] text-[10px] font-mono shrink-0 select-none overflow-hidden h-5"
								title="Temperature: 0.0 - 1.0 (0.1 step, default 0.8)">
								<div
									className="pl-1.5 pr-0.5 text-[var(--vscode-descriptionForeground)] flex items-center cursor-help"
									title={`Temperature: ${temperature.toFixed(1)}`}>
									<ThermometerIcon size={11} />
								</div>
								<button
									type="button"
									onClick={() => handleTemperatureStep(-0.1)}
									disabled={temperature <= 0.05}
									className="px-1 h-full flex items-center justify-center text-[var(--vscode-foreground)] hover:bg-[var(--vscode-toolbar-hoverBackground)] cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed border-0 bg-transparent transition-colors"
									aria-label="Decrease temperature"
									title="Decrease temperature (-0.1)"
									data-testid="temperature-decrement">
									<MinusIcon size={10} />
								</button>
								<input
									type="number"
									min={0}
									max={1}
									step={0.1}
									value={temperature.toFixed(1)}
									onChange={(e) => {
										const val = parseFloat(e.target.value)
										if (!isNaN(val)) {
											void handleTemperatureSelect(val)
										}
									}}
									className="w-[26px] h-full bg-transparent text-center text-[10px] font-mono text-[var(--vscode-foreground)] focus:outline-none border-0 p-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
									data-testid="temperature-input"
									title="Temperature: 0.0 to 1.0 (default 0.8)"
								/>
								<button
									type="button"
									onClick={() => handleTemperatureStep(0.1)}
									disabled={temperature >= 0.95}
									className="px-1 h-full flex items-center justify-center text-[var(--vscode-foreground)] hover:bg-[var(--vscode-toolbar-hoverBackground)] cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed border-0 bg-transparent transition-colors"
									aria-label="Increase temperature"
									title="Increase temperature (+0.1)"
									data-testid="temperature-increment">
									<PlusIcon size={10} />
								</button>
							</div>
						)}
						<span
							className="flex items-center gap-1 shrink-0 px-1.5 py-0.5 rounded bg-[var(--vscode-badge-background)] text-[var(--vscode-badge-foreground)] text-[10px] font-mono select-none"
							data-testid="inference-speed"
							title={
								latestInferenceSpeed
									? `Latest Inference Speed: ${latestInferenceSpeed} tokens/sec`
									: "Inference speed of latest generation"
							}>
							<ZapIcon size={10} />
							<span>{latestInferenceSpeed ? `${latestInferenceSpeed} t/s` : "-- t/s"}</span>
						</span>
					</div>
				</div>
				<div className="flex justify-between items-center -mt-[2px] px-3 pb-2">
					{/* Always render both components, but control visibility with CSS */}
					<div className="relative flex-1 min-w-0 h-5">
						{/* ButtonGroup - always in DOM but visibility controlled */}
						<ButtonGroup className="absolute top-0 left-0 right-0 ease-in-out w-full h-5 z-10 flex items-center">
							<Tooltip>
								<TooltipContent>Add Context</TooltipContent>
								<TooltipTrigger>
									<VSCodeButton
										appearance="icon"
										aria-label="Add Context"
										className="p-0 m-0 flex items-center"
										data-testid="context-button"
										onClick={handleContextButtonClick}>
										<ButtonContainer>
											<AtSignIcon size={12} />
										</ButtonContainer>
									</VSCodeButton>
								</TooltipTrigger>
							</Tooltip>

							<Tooltip>
								<TooltipContent>Add Files & Images</TooltipContent>
								<TooltipTrigger>
									<VSCodeButton
										appearance="icon"
										aria-label="Add Files & Images"
										className="p-0 m-0 flex items-center"
										data-testid="files-button"
										disabled={shouldDisableFilesAndImages}
										onClick={() => {
											if (!shouldDisableFilesAndImages) {
												onSelectFilesAndImages()
											}
										}}>
										<ButtonContainer>
											<PlusIcon size={13} />
										</ButtonContainer>
									</VSCodeButton>
								</TooltipTrigger>
							</Tooltip>

							<ServersToggleModal />

							<ClineRulesToggleModal />

							<ModelContainer>
								{selectedProvider === "ollama" ? (
									<div className="flex items-center w-full min-w-0 mr-1.5 gap-1">
										<ModelSelectDropdown
											aria-label="Select Ollama Model"
											data-testid="ollama-model-select"
											onFocus={requestOllamaModels}
											onChange={(e) => {
												if (e.target.value === "__settings__") {
													handleModelButtonClick()
												} else if (e.target.value) {
													handleOllamaModelSelect(e.target.value)
												}
											}}
											title={`Ollama model for ${mode} mode: ${selectedModelId || "None"}`}
											value={selectedModelId || ""}>
											{ollamaModels.length === 0 && !selectedModelId && (
												<option value="">
													{isRefreshingOllama ? "Loading Ollama models..." : "No Ollama models found"}
												</option>
											)}
											{selectedModelId && !ollamaModels.includes(selectedModelId) && (
												<option key={selectedModelId} value={selectedModelId}>
													{selectedModelId}
												</option>
											)}
											{ollamaModels.map((m) => (
												<option key={m} value={m}>
													{m}
												</option>
											))}
											<option disabled>──────────</option>
											<option value="__settings__">Configure in Settings...</option>
										</ModelSelectDropdown>
										<Tooltip>
											<TooltipContent>Refresh Ollama models</TooltipContent>
											<TooltipTrigger>
												<VSCodeButton
													appearance="icon"
													aria-label="Refresh Ollama models"
													className="p-0 m-0 flex items-center shrink-0"
													data-testid="refresh-ollama-models"
													disabled={isRefreshingOllama}
													onClick={requestOllamaModels}>
													<ButtonContainer>
														<RefreshCwIcon className={isRefreshingOllama ? "animate-spin" : ""} size={11} />
													</ButtonContainer>
												</VSCodeButton>
											</TooltipTrigger>
										</Tooltip>
									</div>
								) : (
									<ModelButtonWrapper>
										<ModelDisplayButton
											disabled={false}
											onClick={handleModelButtonClick}
											role="button"
											tabIndex={0}
											title="Open API Settings">
											<ModelButtonContent className="text-xs flex items-center gap-1">
												{!didHydrateState && <LoaderCircleIcon className="w-3 h-3 animate-spin inline shrink-0" />}
												{modelDisplayName}
											</ModelButtonContent>
										</ModelDisplayButton>
									</ModelButtonWrapper>
								)}
							</ModelContainer>
						</ButtonGroup>
					</div>
					{/* Tooltip for Plan/Act toggle remains outside the conditional rendering */}
					<Tooltip>
						<TooltipContent
							className="text-xs px-2 flex flex-col gap-1"
							hidden={shownTooltipMode === null}
							side="top">
							{`In ${shownTooltipMode === "act" ? "Act" : "Plan"}  mode, Cline will ${shownTooltipMode === "act" ? "complete the task immediately" : "gather information to architect a plan"}`}
							<p className="text-description/80 text-xs mb-0">
								Toggle w/ <kbd className="text-muted-foreground mx-1">{togglePlanActKeys}</kbd>
							</p>
						</TooltipContent>
						<TooltipTrigger>
							<SwitchContainer data-testid="mode-switch" disabled={false} onClick={onModeToggle}>
								<Slider isAct={mode === "act"} isPlan={mode === "plan"} />
								{["Plan", "Act"].map((m) => (
									<div
										aria-checked={mode === m.toLowerCase()}
										className={cn(
											"pt-0.5 pb-px px-2 z-10 text-xs w-1/2 text-center bg-transparent",
											mode === m.toLowerCase() ? "text-white" : "text-input-foreground",
										)}
										key={m}
										onMouseLeave={() => setShownTooltipMode(null)}
										onMouseOver={() => setShownTooltipMode(m.toLowerCase() === "plan" ? "plan" : "act")}
										role="switch">
										{m}
									</div>
								))}
							</SwitchContainer>
						</TooltipTrigger>
					</Tooltip>
				</div>
			</div>
		)
	},
)

export default ChatTextArea

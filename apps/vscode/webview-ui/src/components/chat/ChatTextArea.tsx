import { mentionRegex, mentionRegexGlobal } from "@shared/context-mentions"
import { StringRequest } from "@shared/proto/cline/common"
import { FileSearchRequest, FileSearchType, RelativePathsRequest } from "@shared/proto/cline/file"
import {
	CommitModelSelectionRequest,
	OllamaModelDetailsRequest,
	type OllamaModelDetailsResponse,
	ProbeOllamaContextRequest,
	ReloadOllamaModelRequest,
	UnloadOllamaModelRequest,
	WriteProviderConfigPatch,
	WriteProviderConfigRequest,
} from "@shared/proto/cline/models"
import { PlanActMode, TogglePlanActModeRequest } from "@shared/proto/cline/state"
import { toProtobufModelOverrides } from "@shared/proto-conversions/models/modelOverrides"
import { type SlashCommand } from "@shared/slashCommands"
import { Mode } from "@shared/storage/types"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import {
	AtSignIcon,
	BrainIcon,
	CheckIcon,
	CpuIcon,
	DatabaseIcon,
	DicesIcon,
	EyeIcon,
	InfoIcon,
	LoaderCircleIcon,
	MinusIcon,
	PlusIcon,
	PowerOffIcon,
	RefreshCwIcon,
	RotateCcwIcon,
	SlidersHorizontalIcon,
	SparklesIcon,
	ThermometerIcon,
	TriangleAlertIcon,
	WrenchIcon,
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
import { useApiConfigurationHandlers } from "@/components/settings/utils/useApiConfigurationHandlers"
import { Slider as ContextSlider } from "@/components/ui/slider"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { usePlatform } from "@/context/PlatformContext"
import { useNormalizedApiConfiguration } from "@/hooks/useNormalizedApiConfiguration"
import { useProviderConfig } from "@/hooks/useProviderConfig"
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
import { type AutotuneProbeResult, type ProbeContextFunction, runOllamaAutotune } from "@/utils/ollamaAutotuner"
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

export const CONTEXT_SIZES = [
	512, 768, 1024, 1280, 1536, 1792, 2048, 2560, 3072, 3584, 4096, 5120, 6144, 7168, 8192, 10240, 12288, 14336, 16384, 20480,
	24576, 28672, 32768, 36864, 40960, 45056, 49152, 53248, 57344, 61440, 65536, 69632, 73728, 77824, 81920, 86016, 90112, 94208,
	98304, 102400, 106496, 110592, 114688, 118784, 122880, 126976, 131072, 147456, 163840, 180224, 196608, 229376, 262144, 327680,
	393216, 458752, 524288, 655360, 786432, 917504, 1048576,
] as const

export function formatContextSizeLabel(tokens: number): string {
	if (tokens >= 1024) {
		const k = tokens / 1024
		if (k % 1 === 0) {
			return `${k}K`
		}
		return `${Number(k.toFixed(2))}K`
	}
	return `${tokens}`
}

export function findClosestContextSizeIndex(rawSize: number): number {
	let closest = 0
	let minDiff = Infinity
	CONTEXT_SIZES.forEach((size, idx) => {
		const diff = Math.abs(size - rawSize)
		if (diff < minDiff) {
			minDiff = diff
			closest = idx
		}
	})
	return closest
}

export function findNearestContextSize(rawSize: number): number {
	return CONTEXT_SIZES[findClosestContextSizeIndex(rawSize)]
}

export function findLargestFittingContextSize(rawSize: number): number {
	for (let i = CONTEXT_SIZES.length - 1; i >= 0; i--) {
		if (CONTEXT_SIZES[i] <= rawSize) {
			return CONTEXT_SIZES[i]
		}
	}
	return CONTEXT_SIZES[0]
}

export interface InferenceTelemetry {
	tokensPerSecond: string
	tokensIn: number
	tokensOut: number
	durationMs: number
	cacheReads?: number
	cacheWrites?: number
	promptEvalSpeed?: string
}

export function isOllamaReasoningModel(modelId?: string, modelInfo?: { supportsReasoning?: boolean }): boolean {
	if (modelInfo?.supportsReasoning !== undefined) {
		return modelInfo.supportsReasoning
	}
	if (!modelId) {
		return false
	}
	const lower = modelId.toLowerCase()
	return (
		lower.includes("deepseek-r1") ||
		lower.includes("deepseek-r") ||
		lower.includes("qwq") ||
		lower.includes("qwen3") ||
		lower.includes("thinking") ||
		lower.includes("reasoning") ||
		/(^|[-_:])r1([-_:]|$)/i.test(lower)
	)
}

export function getLatestInferenceTelemetry(
	messages: ReturnType<typeof useExtensionState>["clineMessages"],
): InferenceTelemetry | null {
	if (!messages || messages.length === 0) return null

	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i]
		if (msg.type === "say") {
			if ((msg.say === "api_req_finished" || msg.say === "api_req_started") && msg.text) {
				try {
					const info = JSON.parse(msg.text)
					const tokensOut = typeof info.tokensOut === "number" ? info.tokensOut : 0
					const tokensIn = typeof info.tokensIn === "number" ? info.tokensIn : 0
					let durationMs = typeof info.durationMs === "number" ? info.durationMs : 0
					let speedStr: string | null = null

					if (typeof info.tokensPerSecond === "number" && info.tokensPerSecond > 0) {
						speedStr = info.tokensPerSecond.toFixed(1)
					} else if (durationMs > 50 && tokensOut > 0) {
						speedStr = (tokensOut / (durationMs / 1000)).toFixed(1)
					} else if (tokensOut > 0) {
						for (let j = i - 1; j >= 0; j--) {
							if (messages[j].type === "say" && messages[j].say === "api_req_started") {
								const durationSec = (msg.ts - messages[j].ts) / 1000
								if (durationSec > 0.05 && durationSec < 10000) {
									speedStr = (tokensOut / durationSec).toFixed(1)
									durationMs = Math.round(durationSec * 1000)
								}
								break
							}
						}
					}

					let promptEvalSpeed: string | undefined
					if (typeof info.promptEvalTokensPerSecond === "number" && info.promptEvalTokensPerSecond > 0) {
						promptEvalSpeed = info.promptEvalTokensPerSecond.toFixed(1)
					} else if (typeof info.promptDurationMs === "number" && info.promptDurationMs > 50 && tokensIn > 0) {
						promptEvalSpeed = (tokensIn / (info.promptDurationMs / 1000)).toFixed(1)
					}

					if (speedStr) {
						return {
							tokensPerSecond: speedStr,
							tokensIn,
							tokensOut,
							durationMs,
							cacheReads: typeof info.cacheReads === "number" ? info.cacheReads : undefined,
							cacheWrites: typeof info.cacheWrites === "number" ? info.cacheWrites : undefined,
							promptEvalSpeed,
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

		const latestTelemetry = useMemo(() => getLatestInferenceTelemetry(clineMessages), [clineMessages])
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
		const { config: ollamaConfig, read: readOllamaConfig } = useProviderConfig("ollama")
		// Images are attached regardless; when the selected model has no image input the thumbnails get a warning
		// badge and a notice offers to switch models. Unknown capability data fails open, like core does.
		const modelSupportsImages = selectedModelInfo.supportsImages !== false
		const unsupportedImagesAttached = selectedImages.length > 0 && !modelSupportsImages

		const isLlamaProvider = useMemo(() => {
			if (!selectedProvider) return false
			const lower = selectedProvider.toLowerCase()
			return lower === "ollama" || lower === "llama" || lower.includes("llama")
		}, [selectedProvider])

		const { handleFieldChange, handleFieldsChange } = useApiConfigurationHandlers()
		const [thinkingEnabled, setThinkingEnabled] = useState<boolean>(() => {
			if (typeof apiConfiguration?.ollamaReasoning === "boolean") {
				return apiConfiguration.ollamaReasoning
			}
			if (typeof selectedModelInfo?.supportsReasoning === "boolean") {
				return selectedModelInfo.supportsReasoning
			}
			return isOllamaReasoningModel(selectedModelId, selectedModelInfo)
		})

		const prevModelIdRef = useRef(selectedModelId)
		useEffect(() => {
			if (typeof apiConfiguration?.ollamaReasoning === "boolean") {
				setThinkingEnabled(apiConfiguration.ollamaReasoning)
			} else if (typeof selectedModelInfo?.supportsReasoning === "boolean") {
				setThinkingEnabled(selectedModelInfo.supportsReasoning)
			} else if (prevModelIdRef.current !== selectedModelId) {
				prevModelIdRef.current = selectedModelId
				setThinkingEnabled(isOllamaReasoningModel(selectedModelId, selectedModelInfo))
			}
		}, [apiConfiguration?.ollamaReasoning, selectedModelId, selectedModelInfo])

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

		// Keep ollamaConfig in sync whenever apiConfiguration.ollamaBaseUrl changes
		useEffect(() => {
			if (selectedProvider === "ollama" && typeof readOllamaConfig === "function") {
				void readOllamaConfig()
			}
		}, [selectedProvider, apiConfiguration?.ollamaBaseUrl, readOllamaConfig])

		const ollamaBaseUrl = (apiConfiguration?.ollamaBaseUrl || ollamaConfig?.baseUrl || "")?.trim()

		const [ollamaModelDetails, setOllamaModelDetails] = useState<OllamaModelDetailsResponse | null>(null)
		const [isLoadingModelDetails, setIsLoadingModelDetails] = useState(false)

		// Sampling controls: deterministic seed & min-p
		const [seedEnabled, setSeedEnabled] = useState<boolean>(() => {
			if (typeof apiConfiguration?.ollamaSeedEnabled === "boolean") {
				return apiConfiguration.ollamaSeedEnabled
			}
			try {
				return localStorage.getItem("cline:ollama:seedEnabled") === "true"
			} catch {
				return false
			}
		})
		const [seedValue, setSeedValue] = useState<number>(() => {
			if (typeof apiConfiguration?.ollamaSeedValue === "number" && Number.isFinite(apiConfiguration.ollamaSeedValue)) {
				return apiConfiguration.ollamaSeedValue
			}
			try {
				const s = localStorage.getItem("cline:ollama:seedValue")
				return s ? Number.parseInt(s, 10) : 42
			} catch {
				return 42
			}
		})
		const [minP, setMinP] = useState<number>(() => {
			if (typeof apiConfiguration?.ollamaMinP === "number" && Number.isFinite(apiConfiguration.ollamaMinP)) {
				return Math.max(0, Math.min(1, apiConfiguration.ollamaMinP))
			}
			try {
				const m = localStorage.getItem("cline:ollama:minP")
				return m ? Number.parseFloat(m) : 0.0
			} catch {
				return 0.0
			}
		})

		useEffect(() => {
			if (typeof apiConfiguration?.ollamaSeedEnabled === "boolean") {
				setSeedEnabled(apiConfiguration.ollamaSeedEnabled)
			}
		}, [apiConfiguration?.ollamaSeedEnabled])

		useEffect(() => {
			if (typeof apiConfiguration?.ollamaSeedValue === "number" && Number.isFinite(apiConfiguration.ollamaSeedValue)) {
				setSeedValue(apiConfiguration.ollamaSeedValue)
			}
		}, [apiConfiguration?.ollamaSeedValue])

		useEffect(() => {
			if (typeof apiConfiguration?.ollamaMinP === "number" && Number.isFinite(apiConfiguration.ollamaMinP)) {
				setMinP(Math.max(0, Math.min(1, apiConfiguration.ollamaMinP)))
			}
		}, [apiConfiguration?.ollamaMinP])

		const handleSeedToggle = useCallback(() => {
			setSeedEnabled((prev) => {
				const next = !prev
				try {
					localStorage.setItem("cline:ollama:seedEnabled", String(next))
				} catch {}
				void handleFieldChange("ollamaSeedEnabled", next).catch((err) => {
					console.error("Failed to persist ollamaSeedEnabled:", err)
				})
				return next
			})
		}, [handleFieldChange])

		const handleMinPStep = useCallback((step: number) => {
			setMinP((prev) => {
				const next = Math.max(0, Math.min(1, Math.round((prev + step) * 100) / 100))
				try {
					localStorage.setItem("cline:ollama:minP", String(next))
				} catch {}
				void handleFieldChange("ollamaMinP", next).catch((err) => {
					console.error("Failed to persist ollamaMinP:", err)
				})
				return next
			})
		}, [handleFieldChange])

		const handleMinPChange = useCallback((val: number) => {
			const clamped = Math.max(0, Math.min(1, Math.round(val * 100) / 100))
			setMinP(clamped)
			try {
				localStorage.setItem("cline:ollama:minP", String(clamped))
			} catch {}
			void handleFieldChange("ollamaMinP", clamped).catch((err) => {
				console.error("Failed to persist ollamaMinP:", err)
			})
		}, [handleFieldChange])

		const [topP, setTopP] = useState<number>(() => {
			if (typeof apiConfiguration?.ollamaTopP === "number" && Number.isFinite(apiConfiguration.ollamaTopP)) {
				return Math.max(0, Math.min(1, apiConfiguration.ollamaTopP))
			}
			try {
				const p = localStorage.getItem("cline:ollama:topP")
				return p ? Number.parseFloat(p) : 0.9
			} catch {
				return 0.9
			}
		})

		const [topK, setTopK] = useState<number>(() => {
			if (typeof apiConfiguration?.ollamaTopK === "number" && Number.isFinite(apiConfiguration.ollamaTopK)) {
				return Math.max(0, apiConfiguration.ollamaTopK)
			}
			try {
				const k = localStorage.getItem("cline:ollama:topK")
				return k ? Number.parseInt(k, 10) : 40
			} catch {
				return 40
			}
		})

		useEffect(() => {
			if (typeof apiConfiguration?.ollamaTopP === "number" && Number.isFinite(apiConfiguration.ollamaTopP)) {
				setTopP(Math.max(0, Math.min(1, apiConfiguration.ollamaTopP)))
			}
		}, [apiConfiguration?.ollamaTopP])

		useEffect(() => {
			if (typeof apiConfiguration?.ollamaTopK === "number" && Number.isFinite(apiConfiguration.ollamaTopK)) {
				setTopK(Math.max(0, apiConfiguration.ollamaTopK))
			}
		}, [apiConfiguration?.ollamaTopK])

		const handleTopPStep = useCallback((step: number) => {
			setTopP((prev) => {
				const next = Math.max(0, Math.min(1, Math.round((prev + step) * 100) / 100))
				try {
					localStorage.setItem("cline:ollama:topP", String(next))
				} catch {}
				void handleFieldChange("ollamaTopP", next).catch((err) => {
					console.error("Failed to persist ollamaTopP:", err)
				})
				return next
			})
		}, [handleFieldChange])

		const handleTopPChange = useCallback((val: number) => {
			const clamped = Math.max(0, Math.min(1, Math.round(val * 100) / 100))
			setTopP(clamped)
			try {
				localStorage.setItem("cline:ollama:topP", String(clamped))
			} catch {}
			void handleFieldChange("ollamaTopP", clamped).catch((err) => {
				console.error("Failed to persist ollamaTopP:", err)
			})
		}, [handleFieldChange])

		const handleTopKStep = useCallback((step: number) => {
			setTopK((prev) => {
				const next = Math.max(0, Math.min(200, prev + step))
				try {
					localStorage.setItem("cline:ollama:topK", String(next))
				} catch {}
				void handleFieldChange("ollamaTopK", next).catch((err) => {
					console.error("Failed to persist ollamaTopK:", err)
				})
				return next
			})
		}, [handleFieldChange])

		const handleTopKChange = useCallback((val: number) => {
			const clamped = Math.max(0, Math.min(200, val))
			setTopK(clamped)
			try {
				localStorage.setItem("cline:ollama:topK", String(clamped))
			} catch {}
			void handleFieldChange("ollamaTopK", clamped).catch((err) => {
				console.error("Failed to persist ollamaTopK:", err)
			})
		}, [handleFieldChange])

		const [repeatPenalty, setRepeatPenalty] = useState<number>(() => {
			if (typeof apiConfiguration?.ollamaRepeatPenalty === "number" && Number.isFinite(apiConfiguration.ollamaRepeatPenalty)) {
				return Math.max(0, Math.min(2, apiConfiguration.ollamaRepeatPenalty))
			}
			try {
				const r = localStorage.getItem("cline:ollama:repeatPenalty")
				return r ? Number.parseFloat(r) : 1.1
			} catch {
				return 1.1
			}
		})

		useEffect(() => {
			if (typeof apiConfiguration?.ollamaRepeatPenalty === "number" && Number.isFinite(apiConfiguration.ollamaRepeatPenalty)) {
				setRepeatPenalty(Math.max(0, Math.min(2, apiConfiguration.ollamaRepeatPenalty)))
			}
		}, [apiConfiguration?.ollamaRepeatPenalty])

		const handleRepeatPenaltyStep = useCallback((step: number) => {
			setRepeatPenalty((prev) => {
				const next = Math.max(0, Math.min(2, Math.round((prev + step) * 100) / 100))
				try {
					localStorage.setItem("cline:ollama:repeatPenalty", String(next))
				} catch {}
				void handleFieldChange("ollamaRepeatPenalty", next).catch((err) => {
					console.error("Failed to persist ollamaRepeatPenalty:", err)
				})
				return next
			})
		}, [handleFieldChange])

		const handleRepeatPenaltyChange = useCallback((val: number) => {
			const clamped = Math.max(0, Math.min(2, Math.round(val * 100) / 100))
			setRepeatPenalty(clamped)
			try {
				localStorage.setItem("cline:ollama:repeatPenalty", String(clamped))
			} catch {}
			void handleFieldChange("ollamaRepeatPenalty", clamped).catch((err) => {
				console.error("Failed to persist ollamaRepeatPenalty:", err)
			})
		}, [handleFieldChange])

		// Runtime model options: max generation tokens (num_predict) & GPU offload layers (num_gpu)
		const [numPredict, setNumPredict] = useState<number>(() => {
			if (typeof apiConfiguration?.ollamaNumPredict === "number" && Number.isFinite(apiConfiguration.ollamaNumPredict)) {
				return apiConfiguration.ollamaNumPredict
			}
			try {
				const val = localStorage.getItem("cline:ollama:numPredict")
				return val ? Number.parseInt(val, 10) : 128
			} catch {
				return 128
			}
		})

		const [numGpu, setNumGpu] = useState<number>(() => {
			if (typeof apiConfiguration?.ollamaNumGpu === "number" && Number.isFinite(apiConfiguration.ollamaNumGpu)) {
				return Math.max(0, Math.min(99, apiConfiguration.ollamaNumGpu))
			}
			try {
				const val = localStorage.getItem("cline:ollama:numGpu")
				return val ? Number.parseInt(val, 10) : 99
			} catch {
				return 99
			}
		})

		const [fullGpu, setFullGpu] = useState<boolean>(() => {
			if (typeof apiConfiguration?.ollamaNumGpu === "number") {
				return apiConfiguration.ollamaNumGpu >= 99
			}
			try {
				const val = localStorage.getItem("cline:ollama:fullGpu")
				return val === null ? true : val === "true"
			} catch {
				return true
			}
		})

		const [isPreloadingOllama, setIsPreloadingOllama] = useState(false)
		const [preloadOllamaStatus, setPreloadOllamaStatus] = useState<string | null>(null)

		useEffect(() => {
			if (typeof apiConfiguration?.ollamaNumPredict === "number" && Number.isFinite(apiConfiguration.ollamaNumPredict)) {
				setNumPredict(apiConfiguration.ollamaNumPredict)
			}
		}, [apiConfiguration?.ollamaNumPredict])

		useEffect(() => {
			if (typeof apiConfiguration?.ollamaNumGpu === "number" && Number.isFinite(apiConfiguration.ollamaNumGpu)) {
				setNumGpu(apiConfiguration.ollamaNumGpu)
				setFullGpu(apiConfiguration.ollamaNumGpu >= 99)
			}
		}, [apiConfiguration?.ollamaNumGpu])

		const handleNumPredictChange = useCallback((val: number) => {
			setNumPredict(val)
			try {
				localStorage.setItem("cline:ollama:numPredict", String(val))
			} catch {}
			void handleFieldChange("ollamaNumPredict", val).catch((err) => {
				console.error("Failed to persist ollamaNumPredict:", err)
			})
		}, [handleFieldChange])

		const handleNumGpuChange = useCallback((val: number) => {
			const clamped = Math.max(0, Math.min(99, val))
			setNumGpu(clamped)
			setFullGpu(clamped >= 99)
			try {
				localStorage.setItem("cline:ollama:numGpu", String(clamped))
				localStorage.setItem("cline:ollama:fullGpu", String(clamped >= 99))
			} catch {}
			void handleFieldChange("ollamaNumGpu", clamped).catch((err) => {
				console.error("Failed to persist ollamaNumGpu:", err)
			})
		}, [handleFieldChange])

		const handleFullGpuToggle = useCallback(() => {
			setFullGpu((prev) => {
				const next = !prev
				const nextNumGpu = next ? 99 : 0
				setNumGpu(nextNumGpu)
				try {
					localStorage.setItem("cline:ollama:fullGpu", String(next))
					localStorage.setItem("cline:ollama:numGpu", String(nextNumGpu))
				} catch {}
				void handleFieldChange("ollamaNumGpu", nextNumGpu).catch((err) => {
					console.error("Failed to persist ollamaNumGpu:", err)
				})
				return next
			})
		}, [handleFieldChange])

		const isFirstModelLoadRef = useRef(true)
		const lastAppliedModelRef = useRef<string | undefined>(selectedModelId)

		const hasConfiguredContext =
			(typeof ollamaConfig?.contextWindow === "number" && ollamaConfig.contextWindow > 0) ||
			Boolean(
				typeof apiConfiguration?.ollamaTunedContextSize === "number" &&
					apiConfiguration.ollamaTunedContextSize > 0,
			) ||
			Boolean(
				apiConfiguration?.ollamaApiOptionsCtxNum &&
					Number.parseInt(apiConfiguration.ollamaApiOptionsCtxNum, 10) > 0,
			)

		useEffect(() => {
			if (selectedProvider !== "ollama" || !selectedModelId) {
				setOllamaModelDetails(null)
				return
			}
			let cancelled = false
			setIsLoadingModelDetails(true)
			ModelsServiceClient.getOllamaModelDetails(
				OllamaModelDetailsRequest.create({
					baseUrl: ollamaBaseUrl || "",
					modelName: selectedModelId,
				}),
			)
				.then((details) => {
					if (!cancelled && details) {
						setOllamaModelDetails(details)
						const nativeLen = Number(details.contextLength)
						const isModelSwitch = !isFirstModelLoadRef.current && lastAppliedModelRef.current !== selectedModelId
						isFirstModelLoadRef.current = false
						lastAppliedModelRef.current = selectedModelId
						if (nativeLen > 0 && isModelSwitch && !hasConfiguredContext) {
							setContextSize(nativeLen)
						}
					}
				})
				.catch((err) => {
					console.error("Failed to fetch Ollama model details in ChatTextArea:", err)
				})
				.finally(() => {
					if (!cancelled) {
						setIsLoadingModelDetails(false)
					}
				})
			return () => {
				cancelled = true
			}
		}, [selectedProvider, selectedModelId, ollamaBaseUrl, hasConfiguredContext])

		const requestOllamaStatus = useCallback(
			async (overrideUrl?: string) => {
				const targetUrl = (overrideUrl || ollamaBaseUrl)?.trim()
				if (selectedProvider !== "ollama" || !targetUrl) return
				try {
					const res = await ModelsServiceClient.getOllamaModelStatus(
						StringRequest.create({
							value: targetUrl,
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
			},
			[selectedProvider, ollamaBaseUrl],
		)

		const handleUnloadOllamaModel = useCallback(async () => {
			if (selectedProvider !== "ollama" || !ollamaBaseUrl) return
			setIsUnloadingOllama(true)
			try {
				await ModelsServiceClient.unloadOllamaModel(
					UnloadOllamaModelRequest.create({
						baseUrl: ollamaBaseUrl,
						modelName: ollamaStatus.modelName || selectedModelId || "",
					}),
				)
				setTunedContextSize(null)
				setAutotuneStatusType("idle")
				setAutotuneButtonStatus(null)
				void handleFieldsChange({
					ollamaIsTuned: false,
					ollamaTunedContextSize: undefined,
					ollamaTunedModel: undefined,
				}).catch((err) => console.error("Failed to clear tuned status on unload:", err))
				await requestOllamaStatus()
			} catch (error) {
				console.error("Failed to unload Ollama model in ChatTextArea:", error)
			} finally {
				setIsUnloadingOllama(false)
			}
		}, [selectedProvider, ollamaBaseUrl, ollamaStatus.modelName, selectedModelId, requestOllamaStatus, handleFieldsChange])

		useEffect(() => {
			if (selectedProvider === "ollama" && ollamaBaseUrl) {
				requestOllamaStatus()
				const interval = setInterval(requestOllamaStatus, 5000)
				return () => clearInterval(interval)
			}
		}, [selectedProvider, ollamaBaseUrl, requestOllamaStatus])

		const handleOllamaModelSelect = useCallback(
			async (newModelId: string) => {
				if (!newModelId) return
				try {
					await ModelsServiceClient.commitModelSelection(
						CommitModelSelectionRequest.create({
							providerId: "ollama",
							mode,
							modelId: newModelId,
						}),
					)

					try {
						const details = await ModelsServiceClient.getOllamaModelDetails(
							OllamaModelDetailsRequest.create({
								baseUrl: ollamaBaseUrl || "",
								modelName: newModelId,
							}),
						)
						if (details) {
							setOllamaModelDetails(details)
							lastAppliedModelRef.current = newModelId
						}
					} catch (e) {
						console.error("Failed to fetch Ollama model details on select:", e)
					}
				} catch (error) {
					console.error("Failed to commit Ollama model selection:", error)
				}
			},
			[mode, ollamaBaseUrl],
		)

		const requestOllamaModels = useCallback(async () => {
			if (selectedProvider !== "ollama") return
			setIsRefreshingOllama(true)
			try {
				// Re-read latest provider config so any URL changes in Settings are immediately fresh
				const freshConfig =
					typeof readOllamaConfig === "function" ? await readOllamaConfig().catch(() => null) : null
				const targetBaseUrl = (
					apiConfiguration?.ollamaBaseUrl ||
					freshConfig?.baseUrl ||
					ollamaConfig?.baseUrl ||
					""
				)?.trim()

				if (!targetBaseUrl) {
					setOllamaModels([])
					return
				}

				const response = await ModelsServiceClient.getOllamaModels(
					StringRequest.create({
						value: targetBaseUrl,
					}),
				)
				if (response?.values) {
					setOllamaModels(response.values)
					// If currently selected model does not exist on the refreshed server, auto-select the first available model
					if (response.values.length > 0 && selectedModelId && !response.values.includes(selectedModelId)) {
						handleOllamaModelSelect(response.values[0])
					}
				}
				void requestOllamaStatus(targetBaseUrl)
			} catch (error) {
				console.error("Failed to fetch Ollama models in ChatTextArea:", error)
			} finally {
				setIsRefreshingOllama(false)
			}
		}, [
			selectedProvider,
			readOllamaConfig,
			apiConfiguration?.ollamaBaseUrl,
			ollamaConfig?.baseUrl,
			selectedModelId,
			handleOllamaModelSelect,
			requestOllamaStatus,
		])

		useEffect(() => {
			if (selectedProvider === "ollama" && ollamaBaseUrl) {
				requestOllamaModels()
			}
		}, [selectedProvider, ollamaBaseUrl, requestOllamaModels])

		const effectiveOllamaModel = useMemo(
			() => selectedModelId || ollamaStatus.modelName || (ollamaModels && ollamaModels.length > 0 ? ollamaModels[0] : ""),
			[selectedModelId, ollamaStatus.modelName, ollamaModels],
		)

		// Persisted Model Context Window from config (source of truth is per-model ollamaApiOptionsCtxNum)
		const ollamaModelContextWindow = useMemo(() => {
			if (selectedProvider !== "ollama") return undefined

			// 1. If explicitly tuned for current model, autotuned context size is prioritized
			if (
				Boolean(apiConfiguration?.ollamaIsTuned) &&
				typeof apiConfiguration?.ollamaTunedContextSize === "number" &&
				apiConfiguration.ollamaTunedContextSize > 0 &&
				(!apiConfiguration.ollamaTunedModel ||
					!effectiveOllamaModel ||
					apiConfiguration.ollamaTunedModel === effectiveOllamaModel)
			) {
				return apiConfiguration.ollamaTunedContextSize
			}

			// 2. Check per-model active state key (ollamaApiOptionsCtxNum)
			const ctxNum = Number.parseInt(apiConfiguration?.ollamaApiOptionsCtxNum || "", 10)
			if (Number.isFinite(ctxNum) && ctxNum > 0) {
				return ctxNum
			}

			// 3. Fallback to ollamaTunedContextSize only if explicitly tuned
			if (
				Boolean(apiConfiguration?.ollamaIsTuned) &&
				typeof apiConfiguration?.ollamaTunedContextSize === "number" &&
				apiConfiguration.ollamaTunedContextSize > 0
			) {
				return apiConfiguration.ollamaTunedContextSize
			}

			return undefined
		}, [
			selectedProvider,
			apiConfiguration?.ollamaIsTuned,
			apiConfiguration?.ollamaTunedContextSize,
			apiConfiguration?.ollamaTunedModel,
			effectiveOllamaModel,
			apiConfiguration?.ollamaApiOptionsCtxNum,
		])

		// Context Size Slider state & sync
		const contextWindowFromModel = selectedModelInfo?.contextWindow
		const effectiveRawContextSize = useMemo(() => {
			if (selectedProvider === "ollama") {
				if (ollamaModelContextWindow && ollamaModelContextWindow > 0) {
					return ollamaModelContextWindow
				}
			}
			if (Number.isFinite(contextWindowFromModel) && (contextWindowFromModel ?? 0) > 0) {
				return contextWindowFromModel as number
			}
			return 32768
		}, [
			selectedProvider,
			ollamaModelContextWindow,
			contextWindowFromModel,
		])

		const effectiveContextSize = useMemo(
			() => findNearestContextSize(effectiveRawContextSize),
			[effectiveRawContextSize],
		)

		const [contextSize, setContextSize] = useState<number>(() => findNearestContextSize(effectiveRawContextSize))

		useEffect(() => {
			if (effectiveContextSize && effectiveContextSize > 0) {
				setContextSize(effectiveContextSize)
			}
		}, [effectiveContextSize])

		// Temperature state & sync
		const modelTemp = selectedModelInfo?.temperature
		const configTemp = apiConfiguration?.ollamaTemperature
		const [temperature, setTemperature] = useState<number>(() => {
			if (typeof configTemp === "number" && Number.isFinite(configTemp)) {
				return Math.max(0, Math.min(2, configTemp))
			}
			if (typeof modelTemp === "number" && Number.isFinite(modelTemp)) {
				return Math.max(0, Math.min(2, modelTemp))
			}
			return 0.8
		})

		useEffect(() => {
			if (typeof apiConfiguration?.ollamaTemperature === "number" && Number.isFinite(apiConfiguration.ollamaTemperature)) {
				setTemperature(Math.max(0, Math.min(2, apiConfiguration.ollamaTemperature)))
			} else if (typeof modelTemp === "number" && Number.isFinite(modelTemp)) {
				setTemperature(Math.max(0, Math.min(2, modelTemp)))
			} else {
				setTemperature(0.8)
			}
		}, [apiConfiguration?.ollamaTemperature, modelTemp])

		const handleTemperatureSelect = useCallback(
			async (newTemp: number) => {
				const clamped = Math.max(0, Math.min(2, Math.round(newTemp * 10) / 10))
				setTemperature(clamped)
				if (selectedProvider === "ollama") {
					void handleFieldChange("ollamaTemperature", clamped).catch((err) => {
						console.error("Failed to persist ollamaTemperature:", err)
					})
				}
				const targetModelId = selectedModelId || effectiveOllamaModel
				if (!targetModelId) return
				try {
					await ModelsServiceClient.commitModelSelection(
						CommitModelSelectionRequest.create({
							providerId: selectedProvider,
							mode,
							modelId: targetModelId,
							overrides: toProtobufModelOverrides({
								contextWindow: contextSize,
								temperature: clamped,
								...(typeof thinkingEnabled === "boolean" ? { supportsReasoning: thinkingEnabled } : {}),
							}),
						}),
					)
				} catch (error) {
					console.error("Failed to commit temperature override:", error)
				}
			},
			[selectedProvider, mode, selectedModelId, effectiveOllamaModel, contextSize, thinkingEnabled, handleFieldChange],
		)

		const handleTemperatureStep = useCallback(
			(step: number) => {
				const next = Math.round((temperature + step) * 10) / 10
				void handleTemperatureSelect(next)
			},
			[temperature, handleTemperatureSelect],
		)

		const handleContextSizeSelect = useCallback(
			async (newSize: number) => {
				const clamped = findNearestContextSize(newSize)
				setContextSize(clamped)

				const targetModelId = selectedModelId || effectiveOllamaModel
				if (targetModelId) {
					try {
						await ModelsServiceClient.commitModelSelection(
							CommitModelSelectionRequest.create({
								providerId: selectedProvider,
								mode,
								modelId: targetModelId,
								overrides: toProtobufModelOverrides({
									contextWindow: clamped,
									temperature,
									...(typeof thinkingEnabled === "boolean" ? { supportsReasoning: thinkingEnabled } : {}),
								}),
							}),
						)
					} catch (error) {
						console.error("Failed to commit model context window override:", error)
					}
				}
			},
			[selectedProvider, selectedModelId, effectiveOllamaModel, mode, temperature, thinkingEnabled],
		)

		const handleReasoningToggle = useCallback(async () => {
			const next = !thinkingEnabled
			setThinkingEnabled(next)
			void handleFieldChange("ollamaReasoning", next).catch((err) => {
				console.error("Failed to update Ollama reasoning in config:", err)
			})
			try {
				await ModelsServiceClient.writeProviderConfig(
					WriteProviderConfigRequest.create({
						providerId: "ollama",
						patch: WriteProviderConfigPatch.create({
							reasoning: {
								enabled: next,
							},
						}),
					}),
				)
			} catch (error) {
				console.error("Failed to update Ollama reasoning setting:", error)
			}
			const targetModelId = selectedModelId || effectiveOllamaModel
			if (targetModelId) {
				try {
					await ModelsServiceClient.commitModelSelection(
						CommitModelSelectionRequest.create({
							providerId: selectedProvider,
							mode,
							modelId: targetModelId,
							overrides: toProtobufModelOverrides({
								contextWindow: contextSize,
								temperature,
								supportsReasoning: next,
							}),
						}),
					)
				} catch (error) {
					console.error("Failed to commit reasoning override:", error)
				}
			}
		}, [thinkingEnabled, selectedModelId, effectiveOllamaModel, selectedProvider, mode, contextSize, temperature, handleFieldChange])

		const sliderIndex = useMemo(() => {
			return findClosestContextSizeIndex(contextSize || 32768)
		}, [contextSize])

		const nativeContextLimit = useMemo(() => {
			if (selectedProvider === "ollama") {
				const nativeLen = Number(ollamaModelDetails?.contextLength)
				if (nativeLen && nativeLen > 0) return nativeLen
			}
			const fromModelInfo = Number(selectedModelInfo?.contextWindow)
			if (fromModelInfo && fromModelInfo > 0) return fromModelInfo
			return 0
		}, [selectedProvider, ollamaModelDetails?.contextLength, selectedModelInfo?.contextWindow])

		const isConfigTuned =
			selectedProvider === "ollama" &&
			Boolean(apiConfiguration?.ollamaIsTuned) &&
			typeof apiConfiguration?.ollamaTunedContextSize === "number" &&
			apiConfiguration.ollamaTunedContextSize > 0

		const [isAutotuning, setIsAutotuning] = useState(false)
		const [autotuneButtonStatus, setAutotuneButtonStatus] = useState<string | null>(() => (isConfigTuned ? "Tuned" : null))
		const [autotuneStatusType, setAutotuneStatusType] = useState<"idle" | "running" | "success" | "error">(() =>
			isConfigTuned ? "success" : "idle",
		)
		const [autotuneErrorTooltip, setAutotuneErrorTooltip] = useState<string | null>(null)
		const [tunedContextSize, setTunedContextSize] = useState<number | null>(() =>
			isConfigTuned && apiConfiguration?.ollamaTunedContextSize
				? findNearestContextSize(apiConfiguration.ollamaTunedContextSize)
				: null,
		)
		const autotuneAbortControllerRef = useRef<AbortController | null>(null)

		const tunedContextIndex = useMemo(() => {
			if (!tunedContextSize || tunedContextSize <= 0) return -1
			return findClosestContextSizeIndex(tunedContextSize)
		}, [tunedContextSize])

		// Sync tuned state from config on hydration or external config updates
		useEffect(() => {
			if (isConfigTuned && apiConfiguration?.ollamaTunedContextSize) {
				const snapped = findNearestContextSize(apiConfiguration.ollamaTunedContextSize)
				setTunedContextSize(snapped)
				setContextSize(snapped)
				setAutotuneStatusType("success")
				setAutotuneButtonStatus("Tuned")
			}
		}, [isConfigTuned, apiConfiguration?.ollamaTunedContextSize])

		const handleContextSizeChange = useCallback(
			async (newIndex: number) => {
				const newSize = CONTEXT_SIZES[newIndex]
				if (tunedContextSize !== null) {
					if (newSize === tunedContextSize) {
						setAutotuneStatusType("success")
						setAutotuneButtonStatus("Tuned")
						setAutotuneErrorTooltip(null)
						if (selectedProvider === "ollama") {
							void handleFieldsChange({
								ollamaIsTuned: true,
								ollamaTunedContextSize: tunedContextSize,
								ollamaTunedModel: effectiveOllamaModel,
							}).catch((err) => console.error("Failed to update tuned status on context snap:", err))
						}
					} else {
						setAutotuneStatusType("idle")
						setAutotuneButtonStatus(null)
						setAutotuneErrorTooltip(null)
						if (selectedProvider === "ollama") {
							void handleFieldsChange({
								ollamaIsTuned: false,
								ollamaTunedContextSize: undefined,
								ollamaTunedModel: undefined,
							}).catch((err) => console.error("Failed to update tuned status on context change:", err))
						}
					}
				} else if (autotuneStatusType === "error") {
					setAutotuneStatusType("idle")
					setAutotuneButtonStatus(null)
					setAutotuneErrorTooltip(null)
				}
				await handleContextSizeSelect(newSize)
			},
			[handleContextSizeSelect, tunedContextSize, autotuneStatusType, selectedProvider, handleFieldsChange, effectiveOllamaModel],
		)

		useEffect(() => {
			if (
				apiConfiguration?.ollamaTunedContextSize &&
				apiConfiguration.ollamaTunedModel &&
				effectiveOllamaModel &&
				apiConfiguration.ollamaTunedModel === effectiveOllamaModel
			) {
				const snapped = findNearestContextSize(apiConfiguration.ollamaTunedContextSize)
				setTunedContextSize(snapped)
				if (contextSize === snapped || apiConfiguration.ollamaIsTuned) {
					setAutotuneStatusType("success")
					setAutotuneButtonStatus("Tuned")
				} else {
					setAutotuneStatusType("idle")
					setAutotuneButtonStatus(null)
				}
			} else if (
				apiConfiguration?.ollamaTunedModel &&
				effectiveOllamaModel &&
				apiConfiguration.ollamaTunedModel !== effectiveOllamaModel
			) {
				setTunedContextSize(null)
				setAutotuneStatusType("idle")
				setAutotuneButtonStatus(null)
				setAutotuneErrorTooltip(null)
			}
		}, [
			effectiveOllamaModel,
			selectedProvider,
			contextSize,
			apiConfiguration?.ollamaIsTuned,
			apiConfiguration?.ollamaTunedModel,
			apiConfiguration?.ollamaTunedContextSize,
		])

		const handleAutotuneContext = useCallback(async () => {
			if (selectedProvider !== "ollama" || !effectiveOllamaModel) return

			if (isAutotuning) {
				autotuneAbortControllerRef.current?.abort()
				setIsAutotuning(false)
				setAutotuneStatusType("idle")
				setAutotuneButtonStatus(null)
				return
			}

			if (!ollamaBaseUrl) {
				setAutotuneStatusType("error")
				setAutotuneButtonStatus("Failed")
				setAutotuneErrorTooltip(
					"Ollama server address is not configured.\n\nPlease configure the Ollama base URL in Settings (Providers > Ollama) before running autotune calibration.",
				)
				return
			}

			const abortController = new AbortController()
			autotuneAbortControllerRef.current = abortController
			setIsAutotuning(true)
			setAutotuneStatusType("running")
			setAutotuneButtonStatus("Starting...")
			setAutotuneErrorTooltip(null)

			try {
				let optimalVram = 0
				let optimalSize = 0

				const probeFn: ProbeContextFunction = async (testCtx: number): Promise<AutotuneProbeResult> => {
					const res = await ModelsServiceClient.probeOllamaContext(
						ProbeOllamaContextRequest.create({
							baseUrl: ollamaBaseUrl,
							modelName: effectiveOllamaModel,
							contextWindow: testCtx,
						}),
					)
					if (res.success && res.fitsOnGpu && res.gpuPercent >= 100) {
						optimalVram = Number(res.sizeVram)
						optimalSize = Number(res.size)
					}
					return {
						success: res.success,
						fitsOnGpu: res.fitsOnGpu,
						gpuPercent: res.gpuPercent,
						sizeVram: Number(res.sizeVram),
						size: Number(res.size),
						error: res.error,
					}
				}

				// The goal is to set the maximum amount of context with 100% GPU usage, bounded by the model's Native Limit
				let targetMaxThreshold = nativeContextLimit
				if (targetMaxThreshold <= 0 && effectiveOllamaModel && ollamaBaseUrl) {
					try {
						const details = await ModelsServiceClient.getOllamaModelDetails(
							OllamaModelDetailsRequest.create({
								baseUrl: ollamaBaseUrl,
								modelName: effectiveOllamaModel,
							}),
						)
						if (details) {
							setOllamaModelDetails(details)
							const nativeLen = Number(details.contextLength)
							if (nativeLen > 0) {
								targetMaxThreshold = nativeLen
							}
						}
					} catch (e) {
						console.error("Failed to fetch Ollama model details for autotune target:", e)
					}
				}

				if (targetMaxThreshold <= 0) {
					targetMaxThreshold = contextSize > 0 ? contextSize : 1048576
				}

				const result = await runOllamaAutotune({
					initialContextSize: targetMaxThreshold,
					maxContextSize: targetMaxThreshold,
					probeFn,
					initialAdjustment: 4096,
					minContextSize: 4096,
					minStepSize: 4096,
					onBeforeProbe: (testCtx) => {
						setAutotuneButtonStatus(`Testing ${formatContextSizeLabel(testCtx)}...`)
					},
					onProgress: (p) => {
						setAutotuneButtonStatus(`${formatContextSizeLabel(p.testingContext)}: ${p.gpuPercent}% GPU`)
					},
					signal: abortController.signal,
				})

				if (!result.achievedAllGpu) {
					setAutotuneStatusType("error")
					setAutotuneButtonStatus("Failed")
					setTunedContextSize(null)
					setAutotuneErrorTooltip(
						`Model weights exceed available GPU VRAM even at minimum context (4,096 tokens).\n\n` +
							`This model requires more VRAM than is currently free on your GPU and cannot run 100% on GPU without offloading layers to CPU RAM.\n` +
							`Consider using a smaller model or higher quantization (e.g. Q4_K_M).`,
					)
					return
				}

				const autotunedSize = findLargestFittingContextSize(result.optimalContextSize)
				if (autotunedSize > 0) {
					await handleContextSizeSelect(autotunedSize)
				}

				// Update Ollama GPU/CPU label to indicate 100% of GPU is utilized
				setOllamaStatus((prev) => ({
					...prev,
					isRunning: true,
					modelName: effectiveOllamaModel,
					gpuPercent: 100,
					cpuPercent: 0,
					sizeVram: optimalVram || prev.sizeVram || 0,
					size: optimalSize || prev.size || 0,
				}))

				setTunedContextSize(autotunedSize)
				setAutotuneStatusType("success")
				setAutotuneButtonStatus("Tuned")
				void handleFieldsChange({
					ollamaIsTuned: true,
					ollamaTunedContextSize: autotunedSize,
					ollamaTunedModel: effectiveOllamaModel,
				}).catch((err) => console.error("Failed to persist autotune status:", err))
				// Stays tuned and green permanently
			} catch (err: unknown) {
				const errorObj = err as { message?: string }
				if (errorObj?.message === "Autotune aborted") {
					setAutotuneStatusType("idle")
					setAutotuneButtonStatus(null)
				} else {
					console.error("Autotune failed:", err)
					const rawErr = errorObj?.message || ""
					let detailMessage = ""

					if (/econnrefused|failed to fetch|network error|enotfound|etimedout/i.test(rawErr)) {
						detailMessage =
							`Cannot connect to Ollama at ${ollamaBaseUrl}.\n\n` +
							`Ensure the Ollama server is running and reachable at the configured address, and check your network or firewall settings.`
					} else if (/404|not found/i.test(rawErr)) {
						detailMessage =
							`Model '${effectiveOllamaModel}' was not found in Ollama.\n\n` +
							`Make sure the model is installed by running 'ollama pull ${effectiveOllamaModel}' in your terminal.`
					} else if (/out of memory|cuda|vram|allocation|not enough space/i.test(rawErr)) {
						detailMessage =
							`GPU Out of Memory (OOM).\n\n` +
							`The model weights and KV cache exceeded your GPU's available VRAM.\n` +
							`Try closing other GPU-accelerated applications or free up system resources.`
					} else if (/timeout/i.test(rawErr)) {
						detailMessage =
							`Ollama request timed out.\n\n` +
							`Ollama took too long allocating memory or responding to the probe request.\n` +
							`Your GPU or system may be experiencing heavy load.`
					} else {
						detailMessage = `Calibration failed: ${rawErr || "Unexpected error communicating with Ollama."}`
					}

					setAutotuneStatusType("error")
					setAutotuneButtonStatus("Failed")
					setTunedContextSize(null)
					setAutotuneErrorTooltip(detailMessage)
				}
			} finally {
				setIsAutotuning(false)
				autotuneAbortControllerRef.current = null
			}
		}, [
			selectedProvider,
			effectiveOllamaModel,
			isAutotuning,
			ollamaBaseUrl,
			contextSize,
			nativeContextLimit,
			handleContextSizeSelect,
			requestOllamaStatus,
			handleFieldsChange,
		])

		const handlePreloadOllamaModel = useCallback(async () => {
			const targetModel = (ollamaStatus.modelName || effectiveOllamaModel || selectedModelId)?.trim()
			if (selectedProvider !== "ollama" || !ollamaBaseUrl || !targetModel) return
			setIsPreloadingOllama(true)
			setPreloadOllamaStatus(null)
			try {
				await ModelsServiceClient.reloadOllamaModel(
					ReloadOllamaModelRequest.create({
						baseUrl: ollamaBaseUrl,
						modelName: targetModel,
						contextWindow: contextSize > 0 ? contextSize : 0,
						numGpu: fullGpu ? 99 : numGpu,
						numPredict: numPredict,
						keepAlive: "10m",
						topP: typeof topP === "number" && topP > 0 ? topP : undefined,
						topK: typeof topK === "number" && topK >= 0 ? topK : undefined,
						repeatPenalty: typeof repeatPenalty === "number" && repeatPenalty > 0 ? repeatPenalty : undefined,
					}),
				)
				setPreloadOllamaStatus("Preloaded")
				await requestOllamaStatus()
				setTimeout(() => setPreloadOllamaStatus(null), 3000)
			} catch (err) {
				console.error("Failed to preload Ollama model in ChatTextArea:", err)
				setPreloadOllamaStatus("Failed")
				setTimeout(() => setPreloadOllamaStatus(null), 3000)
			} finally {
				setIsPreloadingOllama(false)
			}
		}, [
			selectedProvider,
			ollamaBaseUrl,
			ollamaStatus.modelName,
			effectiveOllamaModel,
			selectedModelId,
			contextSize,
			fullGpu,
			numGpu,
			numPredict,
			topP,
			topK,
			repeatPenalty,
			requestOllamaStatus,
		])

		const handleResetDefaults = useCallback(() => {
			const defaultTemp = 0.8
			const defaultMinP = 0.0
			const defaultTopP = 0.9
			const defaultTopK = 40
			const defaultRepeatPenalty = 1.1
			const defaultNumPredict = 128
			const defaultNumGpu = 99
			const defaultFullGpu = true
			const defaultSeedEnabled = false
			const defaultSeedValue = 42
			const defaultThinking =
				typeof selectedModelInfo?.supportsReasoning === "boolean"
					? selectedModelInfo.supportsReasoning
					: isOllamaReasoningModel(selectedModelId, selectedModelInfo)

			setTemperature(defaultTemp)
			setMinP(defaultMinP)
			setTopP(defaultTopP)
			setTopK(defaultTopK)
			setRepeatPenalty(defaultRepeatPenalty)
			setNumPredict(defaultNumPredict)
			setNumGpu(defaultNumGpu)
			setFullGpu(defaultFullGpu)
			setSeedEnabled(defaultSeedEnabled)
			setSeedValue(defaultSeedValue)
			setThinkingEnabled(defaultThinking)

			try {
				localStorage.setItem("cline:ollama:temperature", String(defaultTemp))
				localStorage.setItem("cline:ollama:minP", String(defaultMinP))
				localStorage.setItem("cline:ollama:topP", String(defaultTopP))
				localStorage.setItem("cline:ollama:topK", String(defaultTopK))
				localStorage.setItem("cline:ollama:repeatPenalty", String(defaultRepeatPenalty))
				localStorage.setItem("cline:ollama:numPredict", String(defaultNumPredict))
				localStorage.setItem("cline:ollama:numGpu", String(defaultNumGpu))
				localStorage.setItem("cline:ollama:fullGpu", String(defaultFullGpu))
				localStorage.setItem("cline:ollama:seedEnabled", String(defaultSeedEnabled))
				localStorage.setItem("cline:ollama:seedValue", String(defaultSeedValue))
			} catch {}

			void handleFieldsChange({
				ollamaTemperature: defaultTemp,
				ollamaMinP: defaultMinP,
				ollamaTopP: defaultTopP,
				ollamaTopK: defaultTopK,
				ollamaRepeatPenalty: defaultRepeatPenalty,
				ollamaNumPredict: defaultNumPredict,
				ollamaNumGpu: defaultNumGpu,
				ollamaSeedEnabled: defaultSeedEnabled,
				ollamaSeedValue: defaultSeedValue,
				ollamaReasoning: defaultThinking,
			}).catch((err) => {
				console.error("Failed to reset Ollama defaults:", err)
			})
		}, [selectedModelId, selectedModelInfo, handleFieldsChange])

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
				{/* Row 1: Context size slider across full width with native context comparison and model architecture pill */}
				<div className="flex items-center gap-1.5 px-3 pb-1 pt-0.5 text-xs w-full">
					<div
						className="flex items-center gap-1 shrink-0 text-[var(--vscode-descriptionForeground)] select-none text-[11px] font-medium cursor-help"
						title={`Configured Context: ${contextSize.toLocaleString()} tokens`}>
						<DatabaseIcon size={12} />
						<span>Context:</span>
					</div>
					<div className="flex-1 min-w-[60px] relative flex items-center">
						<ContextSlider
							aria-label="Context"
							aria-valuetext={`${contextSize.toLocaleString()} tokens (${formatContextSizeLabel(contextSize)})`}
							className="flex-1 cursor-pointer w-full"
							data-testid="context-size-slider"
							max={CONTEXT_SIZES.length - 1}
							min={0}
							onValueChange={(val: number[]) => handleContextSizeChange(val[0])}
							step={1}
							value={[sliderIndex]}
						/>
						{tunedContextIndex >= 0 && selectedProvider === "ollama" && (
							<Tooltip>
								<TooltipTrigger asChild>
									<button
										aria-label={`Snap to autotuned context size: ${formatContextSizeLabel(tunedContextSize!)}`}
										className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2 h-4 rounded-xs bg-emerald-500 border border-[var(--vscode-editor-background,#1e1e1e)] z-20 cursor-pointer hover:scale-125 transition-transform shadow p-0 flex items-center justify-center"
										data-testid="slider-tuned-indicator"
										onClick={(e) => {
											e.stopPropagation()
											handleContextSizeChange(tunedContextIndex)
										}}
										style={{ left: `${(tunedContextIndex / (CONTEXT_SIZES.length - 1)) * 100}%` }}
										title={`Autotuned Context: ${formatContextSizeLabel(tunedContextSize!)} (${tunedContextSize!.toLocaleString()} tokens)\n100% GPU VRAM Calibrated • Click to snap`}
										type="button">
										<span className="w-0.5 h-2 bg-[var(--vscode-editor-background,#1e1e1e)] rounded-full" />
									</button>
								</TooltipTrigger>
								<TooltipContent className="text-xs p-1.5 font-mono">
									<div className="font-semibold text-emerald-400 flex items-center gap-1">
										<CheckIcon size={12} />
										Autotuned Context: {formatContextSizeLabel(tunedContextSize!)}
									</div>
									<div className="text-[10px] text-[var(--vscode-descriptionForeground)]">
										{tunedContextSize!.toLocaleString()} tokens • 100% GPU Calibrated
									</div>
									{contextSize !== tunedContextSize ? (
										<div className="text-[10px] text-emerald-400/90 mt-1 font-sans">
											⚠️ Context modified. Click to restore tuned size.
										</div>
									) : (
										<div className="text-[10px] text-emerald-500/80 mt-1 font-sans">
											✓ Currently at optimal calibrated size (100% GPU)
										</div>
									)}
								</TooltipContent>
							</Tooltip>
						)}
					</div>
					<span
						className="text-[11px] font-mono text-[var(--vscode-foreground)] shrink-0 whitespace-nowrap select-none font-semibold tabular-nums"
						data-testid="context-size-value"
						title={`Configured Context Window: ${contextSize.toLocaleString()} tokens`}>
						{formatContextSizeLabel(contextSize)}
					</span>

					{(() => {
						const isExceedingNative =
							selectedProvider === "ollama" && nativeContextLimit > 0 && contextSize > nativeContextLimit
						const hasContextInfo =
							selectedProvider === "ollama" ||
							!!ollamaModelDetails ||
							tunedContextSize !== null ||
							Boolean(selectedModelInfo?.contextWindow)

						if (!hasContextInfo) return null

						const tooltipTitle = [
							tunedContextSize !== null && selectedProvider === "ollama"
								? `Autotuned: ${formatContextSizeLabel(tunedContextSize)} (${tunedContextSize.toLocaleString()} tokens)`
								: null,
							`Configured: ${formatContextSizeLabel(contextSize)} (${contextSize.toLocaleString()} tokens)`,
							nativeContextLimit > 0
								? `Native Limit: ${formatContextSizeLabel(nativeContextLimit)} (${nativeContextLimit.toLocaleString()} tokens)`
								: null,
							isExceedingNative
								? `⚠️ Warning: Exceeds model native context limit (${formatContextSizeLabel(nativeContextLimit)})`
								: null,
							ollamaModelDetails?.parameterSize || ollamaModelDetails?.quantizationLevel
								? `Architecture: ${[
										ollamaModelDetails.parameterSize,
										ollamaModelDetails.quantizationLevel,
										ollamaModelDetails.family,
										ollamaModelDetails.format?.toUpperCase(),
									]
										.filter(Boolean)
										.join(" • ")}`
								: null,
							tunedContextIndex >= 0 && contextSize !== tunedContextSize
								? "Click to snap slider to autotuned context"
								: null,
						]
							.filter(Boolean)
							.join("\n")

						return (
							<Tooltip>
								<TooltipTrigger asChild>
									<button
										aria-label={
											isExceedingNative
												? `Model info: Configured context (${formatContextSizeLabel(contextSize)}) exceeds native limit (${formatContextSizeLabel(nativeContextLimit)})`
												: tunedContextSize !== null
													? `Model info: Autotuned context ${formatContextSizeLabel(tunedContextSize)}`
													: "Model information and context specs"
										}
										className={cn(
											"flex items-center justify-center p-1 rounded text-[10px] font-mono transition-colors shrink-0 cursor-pointer select-none",
											isExceedingNative
												? "bg-[var(--vscode-inputValidation-warningBackground,#4a3510)] text-[var(--vscode-inputValidation-warningForeground,#ffcc00)] border border-[var(--vscode-inputValidation-warningBorder,#7a5515)] shadow-xs"
												: tunedContextIndex >= 0 && contextSize === CONTEXT_SIZES[tunedContextIndex]
													? "bg-[var(--vscode-badge-background)] text-[var(--vscode-badge-foreground)] border border-transparent"
													: "bg-transparent border border-[var(--vscode-input-border)] text-[var(--vscode-descriptionForeground)] hover:text-[var(--vscode-foreground)] hover:border-[var(--vscode-focusBorder)]",
										)}
										data-testid="context-info-button"
										onClick={
											tunedContextIndex >= 0 ? () => handleContextSizeChange(tunedContextIndex) : undefined
										}
										title={tooltipTitle}
										type="button">
										<InfoIcon
											className={
												isExceedingNative
													? "text-[var(--vscode-inputValidation-warningForeground,#ffcc00)]"
													: "text-amber-400"
											}
											size={11}
										/>
									</button>
								</TooltipTrigger>
								<TooltipContent className="text-xs p-2.5 font-mono max-w-xs space-y-2">
									<div className="font-semibold text-[var(--vscode-foreground)] flex items-center justify-between border-b border-[var(--vscode-input-border)] pb-1.5">
										<span className="flex items-center gap-1.5">
											<InfoIcon className="text-amber-400 shrink-0" size={12} />
											<span>Model &amp; Context Details</span>
										</span>
										{ollamaModelDetails &&
											(ollamaModelDetails.parameterSize || ollamaModelDetails.quantizationLevel) && (
												<span
													className="text-[10px] text-[var(--vscode-descriptionForeground)]"
													data-testid="tooltip-model-specs-summary">
													{[ollamaModelDetails.parameterSize, ollamaModelDetails.quantizationLevel]
														.filter(Boolean)
														.join(" • ")}
												</span>
											)}
									</div>

									{/* Context Information */}
									<div className="space-y-1 text-[11px]">
										{tunedContextSize !== null && selectedProvider === "ollama" && (
											<div
												className="flex justify-between items-center text-emerald-400"
												data-testid="tooltip-tuned-context">
												<span className="flex items-center gap-1">
													<CheckIcon size={11} />
													<span>Autotuned Context:</span>
												</span>
												<span className="font-semibold">
													{formatContextSizeLabel(tunedContextSize)} (
													{tunedContextSize.toLocaleString()} tokens)
												</span>
											</div>
										)}
										<div
											className="flex justify-between items-center"
											data-testid="tooltip-configured-context">
											<span className="text-[var(--vscode-descriptionForeground)]">
												Configured Context:
											</span>
											<span className="font-semibold text-[var(--vscode-foreground)]">
												{formatContextSizeLabel(contextSize)} ({contextSize.toLocaleString()} tokens)
											</span>
										</div>
										{nativeContextLimit > 0 && (
											<div className="flex justify-between items-center" data-testid="tooltip-native-limit">
												<span className="text-[var(--vscode-descriptionForeground)]">Native Limit:</span>
												<span className="font-semibold text-[var(--vscode-foreground)]">
													{formatContextSizeLabel(nativeContextLimit)} (
													{nativeContextLimit.toLocaleString()} tokens)
												</span>
											</div>
										)}
									</div>

									{/* Limit Warning / Safe Status */}
									{nativeContextLimit > 0 &&
										(isExceedingNative ? (
											<div
												className="text-[10px] p-1.5 rounded bg-[var(--vscode-inputValidation-warningBackground,#4a3510)]/50 text-[var(--vscode-inputValidation-warningForeground,#ffcc00)] border border-[var(--vscode-inputValidation-warningBorder,#7a5515)] leading-tight flex items-start gap-1"
												data-testid="tooltip-native-context-warning">
												<TriangleAlertIcon className="shrink-0 mt-0.5" size={12} />
												<span>
													Configured context exceeds native limit (
													{formatContextSizeLabel(nativeContextLimit)}). May degrade reasoning or cause
													hallucinations.
												</span>
											</div>
										) : (
											<div
												className="text-[10px] text-emerald-400 flex items-center gap-1"
												data-testid="tooltip-native-context-safe">
												<CheckIcon size={11} />
												<span>
													Within native training limit ({formatContextSizeLabel(nativeContextLimit)})
												</span>
											</div>
										))}

									{/* Model Architecture Specs */}
									{ollamaModelDetails && (
										<div
											className="pt-1.5 border-t border-[var(--vscode-input-border)] space-y-1 text-[11px]"
											data-testid="tooltip-model-architecture-specs">
											<div className="text-[10px] font-semibold text-[var(--vscode-descriptionForeground)] uppercase tracking-wider">
												Architecture Specs
											</div>
											{ollamaModelDetails.family && (
												<div className="flex justify-between">
													<span className="text-[var(--vscode-descriptionForeground)]">Family:</span>
													<span className="text-[var(--vscode-foreground)]">
														{ollamaModelDetails.family}
													</span>
												</div>
											)}
											{ollamaModelDetails.format && (
												<div className="flex justify-between">
													<span className="text-[var(--vscode-descriptionForeground)]">Format:</span>
													<span className="text-[var(--vscode-foreground)]">
														{ollamaModelDetails.format.toUpperCase()}
													</span>
												</div>
											)}
											{ollamaModelDetails.parameterSize && (
												<div className="flex justify-between">
													<span className="text-[var(--vscode-descriptionForeground)]">
														Parameters:
													</span>
													<span className="text-[var(--vscode-foreground)]">
														{ollamaModelDetails.parameterSize}
													</span>
												</div>
											)}
											{ollamaModelDetails.quantizationLevel && (
												<div className="flex justify-between">
													<span className="text-[var(--vscode-descriptionForeground)]">
														Quantization:
													</span>
													<span className="text-[var(--vscode-foreground)]">
														{ollamaModelDetails.quantizationLevel}
													</span>
												</div>
											)}
											{ollamaModelDetails.parentModel && (
												<div className="flex justify-between">
													<span className="text-[var(--vscode-descriptionForeground)]">
														Base Model:
													</span>
													<span className="text-[var(--vscode-foreground)]">
														{ollamaModelDetails.parentModel}
													</span>
												</div>
											)}
										</div>
									)}

									{tunedContextIndex >= 0 && contextSize !== tunedContextSize && (
										<div className="text-[10px] text-[var(--vscode-descriptionForeground)] pt-1 border-t border-[var(--vscode-input-border)] text-center">
											Click icon to snap slider to autotuned context
										</div>
									)}
								</TooltipContent>
							</Tooltip>
						)
					})()}

					{selectedProvider === "ollama" && (
						<Tooltip>
							<TooltipTrigger asChild>
								<button
									aria-label={
										isAutotuning
											? `Tuning: ${autotuneButtonStatus || "Running"} (Click to cancel)`
											: autotuneStatusType === "success"
												? `Tuned: ${formatContextSizeLabel(contextSize)} fits 100% on GPU. Click to re-tune.`
												: autotuneStatusType === "error"
													? `Tuning failed: ${autotuneErrorTooltip || autotuneButtonStatus}`
													: "Tune context size to fit 100% on GPU (VRAM)"
									}
									className={cn(
										"flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono transition-colors shrink-0 cursor-pointer select-none",
										isAutotuning
											? "bg-[var(--vscode-button-secondaryBackground)] text-[var(--vscode-button-secondaryForeground)] border border-[var(--vscode-focusBorder)] shadow-sm"
											: autotuneStatusType === "success"
												? "bg-emerald-500/10 text-emerald-500 border border-emerald-500/30 font-medium"
												: autotuneStatusType === "error"
													? "bg-red-500/10 text-red-500 border border-red-500/30"
													: "bg-transparent border border-[var(--vscode-input-border)] text-[var(--vscode-descriptionForeground)] hover:text-[var(--vscode-foreground)] hover:border-[var(--vscode-focusBorder)]",
									)}
									data-testid="ollama-autotune-button"
									disabled={!effectiveOllamaModel && !isAutotuning}
									onClick={handleAutotuneContext}
									type="button">
									{isAutotuning ? (
										<>
											<LoaderCircleIcon className="animate-spin text-amber-400 shrink-0" size={10} />
											<span>{autotuneButtonStatus || "Tuning..."}</span>
										</>
									) : autotuneStatusType === "success" ? (
										<>
											<CheckIcon className="text-emerald-500 shrink-0" size={10} />
											<span>Tuned</span>
										</>
									) : autotuneStatusType === "error" ? (
										<>
											<TriangleAlertIcon className="text-red-500 shrink-0" size={10} />
											<span>Failed</span>
										</>
									) : (
										<>
											<SparklesIcon className="text-amber-400 shrink-0" size={10} />
											<span>Tune</span>
										</>
									)}
								</button>
							</TooltipTrigger>
							<TooltipContent className="text-xs p-2 font-mono max-w-sm">
								<div className="font-semibold text-[var(--vscode-foreground)] flex items-center gap-1.5">
									{isAutotuning ? (
										<>
											<LoaderCircleIcon className="animate-spin text-amber-400 shrink-0" size={12} />
											<span>Tuning in Progress</span>
										</>
									) : autotuneStatusType === "success" ? (
										<>
											<CheckIcon className="text-emerald-500 shrink-0" size={12} />
											<span>GPU Context Tuned</span>
										</>
									) : autotuneStatusType === "error" ? (
										<>
											<TriangleAlertIcon className="text-red-500 shrink-0" size={12} />
											<span>Calibration Failed</span>
										</>
									) : (
										<>
											<SparklesIcon className="text-amber-400 shrink-0" size={12} />
											<span>GPU Context Tune</span>
										</>
									)}
								</div>
								<div className="text-[11px] text-[var(--vscode-descriptionForeground)] mt-1 whitespace-pre-line leading-relaxed">
									{isAutotuning
										? "Calibrating context window size to maximize VRAM utilization without spilling into CPU RAM. Click to cancel."
										: autotuneStatusType === "success"
											? `Calibrated optimal context window (${formatContextSizeLabel(contextSize)} / ${contextSize.toLocaleString()} tokens) to fit 100% in GPU VRAM without CPU spillover. Click to re-tune.`
											: autotuneStatusType === "error"
												? autotuneErrorTooltip || "Encountered an error while communicating with Ollama."
												: nativeContextLimit > 0
													? `Calibrates the context window to maximize context up to the model's native limit (${formatContextSizeLabel(nativeContextLimit)}) while keeping 100% on GPU.`
													: "Calibrates the context window to maximize context up to the model's native limit while keeping 100% on GPU."}
								</div>
							</TooltipContent>
						</Tooltip>
					)}

					{selectedProvider === "ollama" && ollamaModelDetails?.supportsTools && (
						<Tooltip>
							<TooltipTrigger asChild>
								<span
									className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-mono bg-[var(--vscode-badge-background)] text-[var(--vscode-badge-foreground)] shrink-0 select-none cursor-help"
									data-testid="model-tools-badge"
									title="Model verified to support native function / tool calling">
									<WrenchIcon size={10} />
									<span>Tools</span>
								</span>
							</TooltipTrigger>
							<TooltipContent className="text-xs p-2.5 font-mono max-w-xs space-y-2">
								<div className="font-semibold text-[var(--vscode-foreground)] flex items-center justify-between border-b border-[var(--vscode-input-border)] pb-1.5">
									<span className="flex items-center gap-1.5">
										<WrenchIcon className="text-blue-400 shrink-0" size={12} />
										<span>Native Tool Calling</span>
									</span>
									<span className="px-1 py-0.5 rounded text-[9px] bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 font-semibold tracking-wider uppercase">
										VERIFIED
									</span>
								</div>
								<div className="text-[11px] text-[var(--vscode-descriptionForeground)] leading-relaxed">
									Model natively supports Ollama function calling with structured schema validation.
								</div>
								<div className="space-y-1 text-[11px] pt-1 border-t border-[var(--vscode-input-border)]">
									<div className="text-[10px] font-semibold text-[var(--vscode-descriptionForeground)] uppercase tracking-wider">
										Supported Capabilities
									</div>
									<div className="flex justify-between items-center">
										<span className="text-[var(--vscode-descriptionForeground)]">Schema Validation:</span>
										<span className="text-[var(--vscode-foreground)] font-semibold">Strict JSON Schema</span>
									</div>
									<div className="flex justify-between items-center">
										<span className="text-[var(--vscode-descriptionForeground)]">File Operations:</span>
										<span className="text-[var(--vscode-foreground)] font-semibold">Read, Edit, Write, List</span>
									</div>
									<div className="flex justify-between items-center">
										<span className="text-[var(--vscode-descriptionForeground)]">Terminal Commands:</span>
										<span className="text-[var(--vscode-foreground)] font-semibold">Bash / Interactive Tasks</span>
									</div>
									<div className="flex justify-between items-center">
										<span className="text-[var(--vscode-descriptionForeground)]">Codebase Search:</span>
										<span className="text-[var(--vscode-foreground)] font-semibold">Ripgrep &amp; File Tree</span>
									</div>
									<div className="flex justify-between items-center">
										<span className="text-[var(--vscode-descriptionForeground)]">MCP Protocol:</span>
										<span className="text-[var(--vscode-foreground)] font-semibold">Server Tools &amp; Prompts</span>
									</div>
								</div>
								<div className="text-[10px] text-[var(--vscode-descriptionForeground)] pt-1 border-t border-[var(--vscode-input-border)]">
									Native parameters passed directly to Ollama /api/chat
								</div>
							</TooltipContent>
						</Tooltip>
					)}

					{selectedProvider === "ollama" && ollamaModelDetails?.supportsVision && (
						<Tooltip>
							<TooltipTrigger asChild>
								<span
									className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-mono bg-[var(--vscode-badge-background)] text-[var(--vscode-badge-foreground)] shrink-0 select-none cursor-help"
									data-testid="model-vision-badge"
									title="Model verified to support multimodal vision inputs">
									<EyeIcon size={10} />
									<span>Vision</span>
								</span>
							</TooltipTrigger>
							<TooltipContent className="text-xs p-2.5 font-mono max-w-xs space-y-2">
								<div className="font-semibold text-[var(--vscode-foreground)] flex items-center justify-between border-b border-[var(--vscode-input-border)] pb-1.5">
									<span className="flex items-center gap-1.5">
										<EyeIcon className="text-purple-400 shrink-0" size={12} />
										<span>Multimodal Vision</span>
									</span>
									<span className="px-1 py-0.5 rounded text-[9px] bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 font-semibold tracking-wider uppercase">
										VERIFIED
									</span>
								</div>
								<div className="text-[11px] text-[var(--vscode-descriptionForeground)] leading-relaxed">
									Model natively accepts image inputs and visual tokens alongside text prompts.
								</div>
								<div className="space-y-1 text-[11px] pt-1 border-t border-[var(--vscode-input-border)]">
									<div className="text-[10px] font-semibold text-[var(--vscode-descriptionForeground)] uppercase tracking-wider">
										Supported Capabilities
									</div>
									<div className="flex justify-between items-center">
										<span className="text-[var(--vscode-descriptionForeground)]">Image Formats:</span>
										<span className="text-[var(--vscode-foreground)] font-semibold">PNG, JPEG, WebP</span>
									</div>
									<div className="flex justify-between items-center">
										<span className="text-[var(--vscode-descriptionForeground)]">Screenshot Analysis:</span>
										<span className="text-[var(--vscode-foreground)] font-semibold">Browser &amp; UI Review</span>
									</div>
									<div className="flex justify-between items-center">
										<span className="text-[var(--vscode-descriptionForeground)]">Diagram Parsing:</span>
										<span className="text-[var(--vscode-foreground)] font-semibold">Architecture &amp; Mockups</span>
									</div>
								</div>
								<div className="text-[10px] text-[var(--vscode-descriptionForeground)] pt-1 border-t border-[var(--vscode-input-border)]">
									Images are encoded in base64 and sent directly to Ollama
								</div>
							</TooltipContent>
						</Tooltip>
					)}
				</div>

				{/* Row 2: Ollama sampling controls (Temperature, Min-P, Top-P, Top-K, Seed, Think) */}
				{selectedProvider === "ollama" && (
					<div className="flex flex-wrap items-center gap-2 px-3 pb-1.5 pt-0 text-xs">
						{/* Temperature Stepper with Verbose Label */}
						<div
							className="flex items-center rounded border border-[var(--vscode-input-border)] bg-[var(--vscode-input-background)] text-[10px] font-mono shrink-0 select-none overflow-hidden h-5"
							title="Temperature: 0.0 - 2.0 (0.1 step, default 0.8)">
							<div
								className="pl-1.5 pr-0.5 text-[var(--vscode-descriptionForeground)] flex items-center gap-1 cursor-help"
								title={`Temperature: ${temperature.toFixed(1)}`}>
								<ThermometerIcon size={11} />
								<span>Temp</span>
							</div>
							<button
								aria-label="Decrease temperature"
								className="px-1 h-full flex items-center justify-center text-[var(--vscode-foreground)] hover:bg-[var(--vscode-toolbar-hoverBackground)] cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed border-0 bg-transparent transition-colors"
								data-testid="temperature-decrement"
								disabled={temperature <= 0.05}
								onClick={() => handleTemperatureStep(-0.1)}
								title="Decrease temperature (-0.1)"
								type="button">
								<MinusIcon size={10} />
							</button>
							<input
								className="w-[26px] h-full bg-transparent text-center text-[10px] font-mono text-[var(--vscode-foreground)] focus:outline-none border-0 p-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
								data-testid="temperature-input"
								max={2}
								min={0}
								onChange={(e) => {
									const val = parseFloat(e.target.value)
									if (!Number.isNaN(val)) {
										void handleTemperatureSelect(val)
									}
								}}
								step={0.1}
								title="Temperature: 0.0 to 2.0 (default 0.8)"
								type="number"
								value={temperature.toFixed(1)}
							/>
							<button
								aria-label="Increase temperature"
								className="px-1 h-full flex items-center justify-center text-[var(--vscode-foreground)] hover:bg-[var(--vscode-toolbar-hoverBackground)] cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed border-0 bg-transparent transition-colors"
								data-testid="temperature-increment"
								disabled={temperature >= 1.95}
								onClick={() => handleTemperatureStep(0.1)}
								title="Increase temperature (+0.1)"
								type="button">
								<PlusIcon size={10} />
							</button>
						</div>

						{/* Min-P Sampling Stepper */}
						<div
							className="flex items-center rounded border border-[var(--vscode-input-border)] bg-[var(--vscode-input-background)] text-[10px] font-mono shrink-0 select-none overflow-hidden h-5"
							title="Min-P Sampling: filters out tokens with probability < min_p * top_token_prob (0.0 = disabled, default 0.0)">
							<div
								className="pl-1.5 pr-0.5 text-[var(--vscode-descriptionForeground)] flex items-center gap-1 cursor-help"
								title={`Min-P: ${minP.toFixed(2)}`}>
								<SlidersHorizontalIcon size={11} />
								<span>Min-P</span>
							</div>
							<button
								aria-label="Decrease Min-P"
								className="px-1 h-full flex items-center justify-center text-[var(--vscode-foreground)] hover:bg-[var(--vscode-toolbar-hoverBackground)] cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed border-0 bg-transparent transition-colors"
								data-testid="min-p-decrement"
								disabled={minP <= 0.01}
								onClick={() => handleMinPStep(-0.05)}
								title="Decrease Min-P (-0.05)"
								type="button">
								<MinusIcon size={10} />
							</button>
							<input
								className="w-[30px] h-full bg-transparent text-center text-[10px] font-mono text-[var(--vscode-foreground)] focus:outline-none border-0 p-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
								data-testid="min-p-input"
								max={1}
								min={0}
								onChange={(e) => {
									const val = parseFloat(e.target.value)
									if (!Number.isNaN(val)) {
										handleMinPChange(val)
									}
								}}
								step={0.01}
								title="Min-P: 0.00 to 1.00 (default 0.00)"
								type="number"
								value={minP.toFixed(2)}
							/>
							<button
								aria-label="Increase Min-P"
								className="px-1 h-full flex items-center justify-center text-[var(--vscode-foreground)] hover:bg-[var(--vscode-toolbar-hoverBackground)] cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed border-0 bg-transparent transition-colors"
								data-testid="min-p-increment"
								disabled={minP >= 0.99}
								onClick={() => handleMinPStep(0.05)}
								title="Increase Min-P (+0.05)"
								type="button">
								<PlusIcon size={10} />
							</button>
						</div>

						{/* Top-P Nucleus Sampling Stepper */}
						<div
							className="flex items-center rounded border border-[var(--vscode-input-border)] bg-[var(--vscode-input-background)] text-[10px] font-mono shrink-0 select-none overflow-hidden h-5"
							title="Top-P (Nucleus Sampling): 0.9 to 0.95. Accumulates the most likely tokens until their combined probability reaches this threshold (e.g., top 95%). (0.0 to 1.0, default 0.90)">
							<div
								className="pl-1.5 pr-0.5 text-[var(--vscode-descriptionForeground)] flex items-center gap-1 cursor-help"
								title={`Top-P: ${topP.toFixed(2)}`}>
								<span>Top-P</span>
							</div>
							<button
								aria-label="Decrease Top-P"
								className="px-1 h-full flex items-center justify-center text-[var(--vscode-foreground)] hover:bg-[var(--vscode-toolbar-hoverBackground)] cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed border-0 bg-transparent transition-colors"
								data-testid="top-p-decrement"
								disabled={topP <= 0.01}
								onClick={() => handleTopPStep(-0.05)}
								title="Decrease Top-P (-0.05)"
								type="button">
								<MinusIcon size={10} />
							</button>
							<input
								className="w-[30px] h-full bg-transparent text-center text-[10px] font-mono text-[var(--vscode-foreground)] focus:outline-none border-0 p-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
								data-testid="top-p-input"
								max={1}
								min={0}
								onChange={(e) => {
									const val = parseFloat(e.target.value)
									if (!Number.isNaN(val)) {
										handleTopPChange(val)
									}
								}}
								step={0.01}
								title="Top-P: 0.00 to 1.00 (typical 0.90 - 0.95, default 0.90)"
								type="number"
								value={topP.toFixed(2)}
							/>
							<button
								aria-label="Increase Top-P"
								className="px-1 h-full flex items-center justify-center text-[var(--vscode-foreground)] hover:bg-[var(--vscode-toolbar-hoverBackground)] cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed border-0 bg-transparent transition-colors"
								data-testid="top-p-increment"
								disabled={topP >= 1.0}
								onClick={() => handleTopPStep(0.05)}
								title="Increase Top-P (+0.05)"
								type="button">
								<PlusIcon size={10} />
							</button>
						</div>

						{/* Top-K Sampling Stepper */}
						<div
							className="flex items-center rounded border border-[var(--vscode-input-border)] bg-[var(--vscode-input-background)] text-[10px] font-mono shrink-0 select-none overflow-hidden h-5"
							title="Top-K: 40 to 50. Limits the pool of potential next words to strictly the top &quot;K&quot; most probable choices. (0 to 100+, default 40)">
							<div
								className="pl-1.5 pr-0.5 text-[var(--vscode-descriptionForeground)] flex items-center gap-1 cursor-help"
								title={`Top-K: ${topK}`}>
								<span>Top-K</span>
							</div>
							<button
								aria-label="Decrease Top-K"
								className="px-1 h-full flex items-center justify-center text-[var(--vscode-foreground)] hover:bg-[var(--vscode-toolbar-hoverBackground)] cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed border-0 bg-transparent transition-colors"
								data-testid="top-k-decrement"
								disabled={topK <= 0}
								onClick={() => handleTopKStep(-5)}
								title="Decrease Top-K (-5)"
								type="button">
								<MinusIcon size={10} />
							</button>
							<input
								className="w-[28px] h-full bg-transparent text-center text-[10px] font-mono text-[var(--vscode-foreground)] focus:outline-none border-0 p-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
								data-testid="top-k-input"
								max={200}
								min={0}
								onChange={(e) => {
									const val = parseInt(e.target.value, 10)
									if (!Number.isNaN(val)) {
										handleTopKChange(val)
									}
								}}
								step={1}
								title="Top-K: 0 to 100+ (typical 40 - 50, default 40)"
								type="number"
								value={topK}
							/>
							<button
								aria-label="Increase Top-K"
								className="px-1 h-full flex items-center justify-center text-[var(--vscode-foreground)] hover:bg-[var(--vscode-toolbar-hoverBackground)] cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed border-0 bg-transparent transition-colors"
								data-testid="top-k-increment"
								disabled={topK >= 200}
								onClick={() => handleTopKStep(5)}
								title="Increase Top-K (+5)"
								type="button">
								<PlusIcon size={10} />
							</button>
						</div>

						{/* Repeat Penalty Stepper */}
						<div
							className="flex items-center rounded border border-[var(--vscode-input-border)] bg-[var(--vscode-input-background)] text-[10px] font-mono shrink-0 select-none overflow-hidden h-5"
							title="Repeat Penalty: 1.0 to 1.2. Penalizes tokens that have already appeared recently to prevent the model from getting stuck in repetitive loops. (0.0 to 2.0, default 1.10)">
							<div
								className="pl-1.5 pr-0.5 text-[var(--vscode-descriptionForeground)] flex items-center gap-1 cursor-help"
								title={`Repeat Penalty: ${repeatPenalty.toFixed(2)}`}>
								<span>Repeat</span>
							</div>
							<button
								aria-label="Decrease repeat penalty"
								className="px-1 h-full flex items-center justify-center text-[var(--vscode-foreground)] hover:bg-[var(--vscode-toolbar-hoverBackground)] cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed border-0 bg-transparent transition-colors"
								data-testid="repeat-penalty-decrement"
								disabled={repeatPenalty <= 0.05}
								onClick={() => handleRepeatPenaltyStep(-0.05)}
								title="Decrease repeat penalty (-0.05)"
								type="button">
								<MinusIcon size={10} />
							</button>
							<input
								className="w-[28px] h-full bg-transparent text-center text-[10px] font-mono text-[var(--vscode-foreground)] focus:outline-none border-0 p-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
								data-testid="repeat-penalty-input"
								max={2}
								min={0}
								onChange={(e) => {
									const val = parseFloat(e.target.value)
									if (!Number.isNaN(val)) {
										handleRepeatPenaltyChange(val)
									}
								}}
								step={0.01}
								title="Repeat Penalty: 0.00 to 2.00 (typical 1.00 - 1.20, default 1.10)"
								type="number"
								value={repeatPenalty.toFixed(2)}
							/>
							<button
								aria-label="Increase repeat penalty"
								className="px-1 h-full flex items-center justify-center text-[var(--vscode-foreground)] hover:bg-[var(--vscode-toolbar-hoverBackground)] cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed border-0 bg-transparent transition-colors"
								data-testid="repeat-penalty-increment"
								disabled={repeatPenalty >= 2.0}
								onClick={() => handleRepeatPenaltyStep(0.05)}
								title="Increase repeat penalty (+0.05)"
								type="button">
								<PlusIcon size={10} />
							</button>
						</div>

						{/* Separator */}
						<div className="h-3.5 w-px bg-[var(--vscode-input-border)] shrink-0 mx-0.5" aria-hidden="true" />

						{/* Reset Defaults Button */}
						<button
							aria-label="Reset all Ollama model settings to recommended defaults"
							className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-[var(--vscode-input-border)] bg-transparent hover:bg-[var(--vscode-toolbar-hoverBackground)] text-[var(--vscode-descriptionForeground)] hover:text-[var(--vscode-foreground)] text-[10px] font-mono transition-colors cursor-pointer select-none shrink-0"
							data-testid="ollama-reset-defaults-button"
							onClick={handleResetDefaults}
							title="Reset all settings to recommended defaults:&#10;Temp: 0.8, Min-P: 0.00, Top-P: 0.90, Top-K: 40, Repeat: 1.10&#10;Predict: 128, GPU: Full (99), Seed: Off, Think: Default"
							type="button">
							<RotateCcwIcon size={10} />
							<span>Defaults</span>
						</button>
					</div>
				)}

				{/* Row 3: Ollama hardware & lifecycle: GPU/CPU percentage, Unload, Preload, Max tokens (num_predict), GPU offload layers (num_gpu) */}
				{selectedProvider === "ollama" && (
					<div className="flex flex-wrap items-center gap-2 px-3 pb-1.5 pt-0 text-xs">
						{/* GPU/CPU Ratio Badge & Model Unload */}
						<div className="flex items-center gap-1 shrink-0">
							{(() => {
								const isTuned =
									autotuneStatusType === "success" ||
									tunedContextSize !== null ||
									(selectedProvider === "ollama" && Boolean(apiConfiguration?.ollamaIsTuned))
								const isRunning = isTuned || ollamaStatus.isRunning
								const gpuPercent = isTuned ? 100 : (ollamaStatus.isRunning ? ollamaStatus.gpuPercent : 100)
								const vramBytes = Number(ollamaStatus.sizeVram || 0)
								const vramGb = vramBytes > 0 ? (vramBytes / (1024 * 1024 * 1024)).toFixed(1) : null

								let ratioBg = "#544120"
								if (gpuPercent >= 100) {
									ratioBg = "#223b2d"
								} else if (gpuPercent <= 0) {
									ratioBg = "#522b2b"
								}

								return (
									<div
										className="flex items-center gap-1.5 px-1.5 py-0.5 rounded text-[10px] font-mono select-none text-white transition-colors"
										data-testid="gpu-cpu-ratio"
										style={{ backgroundColor: ratioBg }}
										title={
											isTuned
												? `Ollama Active Model: ${ollamaStatus.modelName || effectiveOllamaModel || selectedModelId}\n100% GPU Utilized (0% CPU Offload)${vramBytes > 0 ? `\nVRAM: ${(vramBytes / (1024 * 1024 * 1024)).toFixed(2)} GB` : ""}`
												: isRunning
													? `Ollama Active Model: ${ollamaStatus.modelName || selectedModelId}\nVRAM: ${(Number(ollamaStatus.sizeVram) / (1024 * 1024 * 1024)).toFixed(2)} GB / ${(Number(ollamaStatus.size) / (1024 * 1024 * 1024)).toFixed(2)} GB (${ollamaStatus.gpuPercent}% GPU / ${ollamaStatus.cpuPercent}% CPU)`
													: "Ollama: Ready / Idle (loads weights into VRAM on generation)"
										}>
										<CpuIcon size={11} />
										<span>
											{isTuned
												? `GPU: 100%${vramGb ? ` (${vramGb} GB)` : ""}`
												: isRunning
													? `GPU: ${ollamaStatus.gpuPercent}%${vramGb ? ` (${vramGb} GB)` : ""}`
													: "GPU: 100% (Idle)"}
										</span>
									</div>
								)
							})()}
							<button
								aria-label="Free VRAM"
								className="flex items-center justify-center p-1 rounded bg-[var(--vscode-button-secondaryBackground)] hover:bg-[var(--vscode-button-secondaryHoverBackground)] text-[var(--vscode-button-secondaryForeground)] cursor-pointer transition-colors border-0 select-none disabled:opacity-40 disabled:cursor-not-allowed"
								data-testid="unload-ollama-model-button"
								disabled={isUnloadingOllama || (!ollamaStatus.isRunning && autotuneStatusType !== "success" && !ollamaStatus.modelName)}
								onClick={handleUnloadOllamaModel}
								title={
									ollamaStatus.isRunning || autotuneStatusType === "success"
										? `Unload ${ollamaStatus.modelName || selectedModelId} and free VRAM (${(Number(ollamaStatus.sizeVram) / (1024 * 1024 * 1024)).toFixed(2)} GB)`
										: "No model currently loaded in VRAM"
								}
								type="button">
								<PowerOffIcon className={isUnloadingOllama ? "animate-spin" : ""} size={11} />
							</button>
						</div>

						{/* Preload / Warmup Button */}
						<button
							aria-label="Preload model into VRAM"
							className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono transition-colors cursor-pointer select-none bg-[var(--vscode-button-secondaryBackground)] hover:bg-[var(--vscode-button-secondaryHoverBackground)] text-[var(--vscode-button-secondaryForeground)] border border-transparent disabled:opacity-40 disabled:cursor-not-allowed"
							data-testid="ollama-preload-button"
							disabled={isPreloadingOllama || !selectedModelId}
							onClick={handlePreloadOllamaModel}
							title="Preload Model: Issue lightweight request with keep_alive: 10m to warm up weights and KV cache in VRAM"
							type="button">
							<ZapIcon className={isPreloadingOllama ? "animate-spin text-amber-400" : "text-amber-400"} size={11} />
							<span>{isPreloadingOllama ? "Preloading..." : preloadOllamaStatus ? preloadOllamaStatus : "Preload"}</span>
						</button>

						{/* Max Generation Tokens (num_predict) */}
						<div
							className="flex items-center rounded border border-[var(--vscode-input-border)] bg-[var(--vscode-input-background)] text-[10px] font-mono shrink-0 select-none overflow-hidden h-5"
							title="Max Generation Tokens (num_predict): limits maximum tokens generated (-1 for unlimited, default 128)">
							<div
								className="pl-1.5 pr-0.5 text-[var(--vscode-descriptionForeground)] flex items-center gap-1 cursor-help"
								title={`Max Tokens: ${numPredict === -1 ? "Unlimited (-1)" : numPredict}`}>
								<span>Predict</span>
							</div>
							<button
								aria-label="Decrease max tokens"
								className="px-1 h-full flex items-center justify-center text-[var(--vscode-foreground)] hover:bg-[var(--vscode-toolbar-hoverBackground)] cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed border-0 bg-transparent transition-colors"
								data-testid="num-predict-decrement"
								disabled={numPredict <= -1}
								onClick={() => {
									if (numPredict <= 128 && numPredict > -1) {
										handleNumPredictChange(-1)
									} else if (numPredict > 128) {
										handleNumPredictChange(Math.max(128, numPredict - 128))
									}
								}}
								title="Decrease max tokens (-128)"
								type="button">
								<MinusIcon size={10} />
							</button>
							<input
								className="w-[36px] h-full bg-transparent text-center text-[10px] font-mono text-[var(--vscode-foreground)] focus:outline-none border-0 p-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
								data-testid="num-predict-input"
								onChange={(e) => {
									const val = parseInt(e.target.value, 10)
									if (!Number.isNaN(val)) {
										handleNumPredictChange(val)
									}
								}}
								title="Max generation tokens (-1 for unlimited)"
								type="number"
								value={numPredict}
							/>
							<button
								aria-label="Increase max tokens"
								className="px-1 h-full flex items-center justify-center text-[var(--vscode-foreground)] hover:bg-[var(--vscode-toolbar-hoverBackground)] cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed border-0 bg-transparent transition-colors"
								data-testid="num-predict-increment"
								onClick={() => {
									if (numPredict === -1) {
										handleNumPredictChange(128)
									} else {
										handleNumPredictChange(numPredict + 128)
									}
								}}
								title="Increase max tokens (+128)"
								type="button">
								<PlusIcon size={10} />
							</button>
						</div>

						{/* Full GPU Toggle & Layer Stepper */}
						<button
							aria-label={fullGpu ? "Custom GPU layers" : "Full GPU offload"}
							className={`flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-mono transition-colors cursor-pointer select-none ${
								fullGpu
									? "bg-[var(--vscode-button-secondaryBackground)] border-[var(--vscode-button-border,var(--vscode-button-secondaryBackground))] text-[var(--vscode-button-secondaryForeground)]"
									: "bg-transparent border-[var(--vscode-input-border)] text-[var(--vscode-descriptionForeground)] hover:text-[var(--vscode-foreground)]"
							}`}
							data-testid="ollama-full-gpu-toggle"
							onClick={handleFullGpuToggle}
							title={
								fullGpu
									? "Full GPU Offload: 99 layers (all layers on GPU)\nClick to set custom layer count"
									: `Custom GPU Layers: ${numGpu} layers\nClick for Full GPU (99)`
							}
							type="button">
							<CpuIcon size={11} />
							<span>GPU: {fullGpu ? "Full (99)" : `${numGpu}L`}</span>
						</button>

						{!fullGpu && (
							<div
								className="flex items-center rounded border border-[var(--vscode-input-border)] bg-[var(--vscode-input-background)] text-[10px] font-mono shrink-0 select-none overflow-hidden h-5"
								title="GPU Offload Layers (num_gpu): 0 to 99 layers">
								<button
									aria-label="Decrease GPU layers"
									className="px-1 h-full flex items-center justify-center text-[var(--vscode-foreground)] hover:bg-[var(--vscode-toolbar-hoverBackground)] cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed border-0 bg-transparent transition-colors"
									data-testid="num-gpu-decrement"
									disabled={numGpu <= 0}
									onClick={() => handleNumGpuChange(numGpu - 1)}
									title="Decrease GPU layers (-1)"
									type="button">
									<MinusIcon size={10} />
								</button>
								<input
									className="w-[26px] h-full bg-transparent text-center text-[10px] font-mono text-[var(--vscode-foreground)] focus:outline-none border-0 p-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
									data-testid="num-gpu-input"
									max={99}
									min={0}
									onChange={(e) => {
										const val = parseInt(e.target.value, 10)
										if (!Number.isNaN(val)) {
											handleNumGpuChange(val)
										}
									}}
									title="GPU layers (0 to 99)"
									type="number"
									value={numGpu}
								/>
								<button
									aria-label="Increase GPU layers"
									className="px-1 h-full flex items-center justify-center text-[var(--vscode-foreground)] hover:bg-[var(--vscode-toolbar-hoverBackground)] cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed border-0 bg-transparent transition-colors"
									data-testid="num-gpu-increment"
									disabled={numGpu >= 99}
									onClick={() => handleNumGpuChange(numGpu + 1)}
									title="Increase GPU layers (+1)"
									type="button">
									<PlusIcon size={10} />
								</button>
							</div>
						)}

						{/* Deterministic Seed Toggle */}
						<button
							aria-label={seedEnabled ? "Disable deterministic seed" : "Enable deterministic seed"}
							className={`flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-mono transition-colors cursor-pointer select-none ${
								seedEnabled
									? "bg-[var(--vscode-button-secondaryBackground)] border-[var(--vscode-button-border,var(--vscode-button-secondaryBackground))] text-[var(--vscode-button-secondaryForeground)]"
									: "bg-transparent border-[var(--vscode-input-border)] text-[var(--vscode-descriptionForeground)] hover:text-[var(--vscode-foreground)]"
							}`}
							data-testid="ollama-seed-toggle"
							onClick={handleSeedToggle}
							title={
								seedEnabled
									? `Deterministic Seed: ${seedValue} (reproducible generations)\nClick to randomize`
									: "Deterministic Seed: Off (random outputs)\nClick to enable fixed seed (42)"
							}
							type="button">
							<DicesIcon size={11} />
							<span>Seed: {seedEnabled ? seedValue : "Off"}</span>
						</button>

						{/* Reasoning Mode Toggle */}
						<button
							aria-label={thinkingEnabled ? "Disable reasoning mode" : "Enable reasoning mode"}
							className={`flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-mono transition-colors cursor-pointer select-none ${
								thinkingEnabled
									? "bg-[var(--vscode-button-secondaryBackground)] border-[var(--vscode-button-border,var(--vscode-button-secondaryBackground))] text-[var(--vscode-button-secondaryForeground)]"
									: "bg-transparent border-[var(--vscode-input-border)] text-[var(--vscode-descriptionForeground)] hover:text-[var(--vscode-foreground)]"
							}`}
							data-testid="ollama-reasoning-toggle"
							onClick={handleReasoningToggle}
							title={`Reasoning Mode (think: ${thinkingEnabled ? "on" : "off"})\nClick to toggle reasoning thoughts for ${selectedModelId}`}
							type="button">
							<BrainIcon size={11} />
							<span>Think: {thinkingEnabled ? "ON" : "OFF"}</span>
						</button>
					</div>
				)}
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
											onChange={(e) => {
												if (e.target.value === "__settings__") {
													handleModelButtonClick()
												} else if (e.target.value) {
													handleOllamaModelSelect(e.target.value)
												}
											}}
											onFocus={requestOllamaModels}
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
														<RefreshCwIcon
															className={isRefreshingOllama ? "animate-spin" : ""}
															size={11}
														/>
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
												{!didHydrateState && (
													<LoaderCircleIcon className="w-3 h-3 animate-spin inline shrink-0" />
												)}
												{modelDisplayName}
											</ModelButtonContent>
										</ModelDisplayButton>
									</ModelButtonWrapper>
								)}
							</ModelContainer>
						</ButtonGroup>
					</div>
					<div className="flex items-center gap-2 shrink-0">
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

						{/* Telemetry tokens per second label placed to the right of Plan / Action toggle */}
						{latestTelemetry ? (
							<Tooltip>
								<TooltipTrigger asChild>
									<span
										className="flex items-center gap-1 shrink-0 px-1.5 py-0.5 rounded bg-[var(--vscode-badge-background)] text-[var(--vscode-badge-foreground)] text-[10px] font-mono select-none cursor-pointer"
										data-testid="inference-speed">
										<ZapIcon size={10} />
										<span>{latestTelemetry.tokensPerSecond} t/s</span>
									</span>
								</TooltipTrigger>
								<TooltipContent className="text-xs p-2 font-mono max-w-xs" side="top">
									<span className="font-semibold border-b border-[var(--vscode-input-border)] pb-1 mb-1 text-[var(--vscode-foreground)] flex items-center gap-1">
										<ZapIcon className="text-yellow-400" size={12} />
										<span>Inference Telemetry</span>
									</span>
									<span className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px]">
										<span className="text-[var(--vscode-descriptionForeground)]">Decode Speed:</span>
										<span className="text-right text-[var(--vscode-foreground)] font-bold">
											{latestTelemetry.tokensPerSecond} t/s
										</span>
										{latestTelemetry.promptEvalSpeed && (
											<>
												<span className="text-[var(--vscode-descriptionForeground)]">
													Prefill Speed:
												</span>
												<span className="text-right text-[var(--vscode-foreground)]">
													{latestTelemetry.promptEvalSpeed} t/s
												</span>
											</>
										)}
										<span className="text-[var(--vscode-descriptionForeground)]">Output Tokens:</span>
										<span className="text-right text-[var(--vscode-foreground)]">
											{latestTelemetry.tokensOut.toLocaleString()}
										</span>
										<span className="text-[var(--vscode-descriptionForeground)]">Prompt Tokens:</span>
										<span className="text-right text-[var(--vscode-foreground)]">
											{latestTelemetry.tokensIn.toLocaleString()}
										</span>
										{latestTelemetry.durationMs > 0 && (
											<>
												<span className="text-[var(--vscode-descriptionForeground)]">Duration:</span>
												<span className="text-right text-[var(--vscode-foreground)]">
													{(latestTelemetry.durationMs / 1000).toFixed(2)}s
												</span>
											</>
										)}
										{latestTelemetry.cacheReads !== undefined && latestTelemetry.cacheReads > 0 && (
											<>
												<span className="text-[var(--vscode-descriptionForeground)]">
													Cached Tokens:
												</span>
												<span className="text-right text-[var(--vscode-foreground)]">
													{latestTelemetry.cacheReads.toLocaleString()}
												</span>
											</>
										)}
									</span>
								</TooltipContent>
							</Tooltip>
						) : isLlamaProvider ? (
							<span
								className="flex items-center gap-1 shrink-0 px-1.5 py-0.5 rounded bg-[var(--vscode-badge-background)] text-[var(--vscode-badge-foreground)] text-[10px] font-mono select-none opacity-60"
								data-testid="inference-speed"
								title="Inference speed of latest generation">
								<ZapIcon size={10} />
								<span>-- t/s</span>
							</span>
						) : null}
					</div>
				</div>
			</div>
		)
	},
)

export default ChatTextArea

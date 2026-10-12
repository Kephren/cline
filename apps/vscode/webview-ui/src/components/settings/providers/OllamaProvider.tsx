import { openAiModelInfoSafeDefaults } from "@shared/api"
import { StringRequest } from "@shared/proto/cline/common"
import { Mode } from "@shared/storage/types"
import { VSCodeCheckbox, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useProviderConfig } from "@/hooks/useProviderConfig"
import { useProviderModelSelection } from "@/hooks/useProviderModelSelection"
import { ModelsServiceClient } from "@/services/grpc-client"
import { ApiKeyField } from "../common/ApiKeyField"
import { BaseUrlField } from "../common/BaseUrlField"
import { DebouncedTextField } from "../common/DebouncedTextField"
import OllamaModelPicker from "../OllamaModelPicker"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"
import { useProviderApiKeyField } from "../utils/useProviderApiKeyField"

/**
 * Props for the OllamaProvider component
 */
interface OllamaProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

/**
 * The Ollama provider configuration component
 */
export const OllamaProvider = ({ showModelOptions, isPopup, currentMode }: OllamaProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange, handleFieldsChange } = useApiConfigurationHandlers()
	const { config, write, commitSelection } = useProviderConfig("ollama")

	const [ollamaModels, setOllamaModels] = useState<string[]>([])

	const ollamaBaseUrl = config?.baseUrl ?? apiConfiguration?.ollamaBaseUrl
	// providers.json (config.contextWindow) is the source of truth; the legacy
	// apiConfiguration string is a migration fallback.
	const ollamaNumCtx = config?.contextWindow || Number.parseInt(apiConfiguration?.ollamaApiOptionsCtxNum || "", 10)
	const ollamaModelInfo = useMemo(() => {
		return {
			...openAiModelInfoSafeDefaults,
			...(Number.isFinite(ollamaNumCtx) && ollamaNumCtx > 0 ? { contextWindow: ollamaNumCtx } : {}),
		}
	}, [ollamaNumCtx])
	const ollamaModelInfoById = useMemo(
		() => Object.fromEntries(ollamaModels.map((modelId) => [modelId, { ...ollamaModelInfo, name: modelId }])),
		[ollamaModelInfo, ollamaModels],
	)
	const { selectedModel, commitModelSelection } = useProviderModelSelection("ollama", currentMode, {
		models: ollamaModelInfoById,
		config,
		commitSelection,
		fallbackModelInfo: ollamaModelInfo,
		customModelInfo: (modelId) => ({ ...ollamaModelInfo, name: modelId }),
	})
	const { savedApiKeyMask, handleApiKeyChange } = useProviderApiKeyField({
		apiKeyLength: config?.apiKeyLength,
		providerName: "Ollama",
		write,
	})

	const handleBaseUrlChange = useCallback(
		(value: string) => {
			void write({ baseUrl: value }).catch((error) => console.error("Failed to update Ollama base URL:", error))
		},
		[write],
	)
	const handleBaseUrlClear = useCallback(async () => {
		try {
			await write({ baseUrl: "" })
		} catch (error) {
			console.error("Failed to clear Ollama base URL:", error)
			throw error
		}
	}, [write])

	// Fetch ollama models on mount and whenever the base URL changes. The
	// picker also refetches on focus — do NOT poll on an interval: the base
	// URL is user-configurable, so an unbounded poll can hammer a remote or
	// metered endpoint for as long as the settings pane is open (ENG-2344).
	const requestOllamaModels = useCallback(async () => {
		try {
			const response = await ModelsServiceClient.getOllamaModels(
				StringRequest.create({
					value: ollamaBaseUrl || "",
				}),
			)
			if (response && response.values) {
				setOllamaModels(response.values)
			}
		} catch (error) {
			console.error("Failed to fetch Ollama models:", error)
			setOllamaModels([])
		}
	}, [ollamaBaseUrl])

	useEffect(() => {
		requestOllamaModels()
	}, [requestOllamaModels])

	return (
		<div className="flex flex-col gap-2">
			<BaseUrlField
				initialValue={ollamaBaseUrl}
				label="Use custom base URL"
				onChange={handleBaseUrlChange}
				onClear={handleBaseUrlClear}
				placeholder="Default: http://localhost:11434"
			/>

			{ollamaBaseUrl && (
				<ApiKeyField
					helpText="Optional API key for authenticated Ollama instances or cloud services. Leave empty for local installations."
					initialValue={savedApiKeyMask}
					onChange={handleApiKeyChange}
					placeholder="Enter API Key (optional)..."
					providerName="Ollama"
				/>
			)}

			{/* Model selection - use filterable picker */}
			<label htmlFor="ollama-model-selection">
				<span className="font-semibold">Model</span>
			</label>
			<OllamaModelPicker
				ollamaModels={ollamaModels}
				onFocus={requestOllamaModels}
				onModelChange={(modelId) => {
					const trimmedModelId = modelId.trim()
					if (!trimmedModelId) {
						return
					}
					if (apiConfiguration?.ollamaTunedModel && apiConfiguration.ollamaTunedModel !== trimmedModelId) {
						void handleFieldsChange({
							ollamaIsTuned: false,
							ollamaTunedContextSize: undefined,
							ollamaTunedModel: undefined,
						}).catch((err) => console.error("Failed to reset tuned state on model change:", err))
					}
					void commitModelSelection({
						modelId: trimmedModelId,
						overrides: Number.isFinite(ollamaNumCtx) && ollamaNumCtx > 0 ? { contextWindow: ollamaNumCtx } : undefined,
						modelInfo: { ...ollamaModelInfo, name: trimmedModelId },
					}).catch((error) => console.error("Failed to update Ollama model selection:", error))
				}}
				placeholder={ollamaModels.length > 0 ? "Search and select a model..." : "e.g. llama3.1"}
				selectedModelId={selectedModel.modelId || ""}
			/>

			{/* Show status message based on model availability */}
			{ollamaModels.length === 0 && (
				<p className="text-sm mt-1 text-description italic">
					Unable to fetch models from Ollama server. Please ensure Ollama is running and accessible, or enter the model
					ID manually above.
				</p>
			)}

			{/* Render only after the provider config RPC has resolved: the
			    debounced input fires onChange for its initial value shortly
			    after mount, so mounting before `config` loads would persist
			    the 32768 fallback over a value saved in providers.json. */}
			{config !== undefined && (
				<DebouncedTextField
					initialValue={Number.isFinite(ollamaNumCtx) && ollamaNumCtx > 0 ? String(ollamaNumCtx) : ""}
					onChange={(v) => {
						const contextWindow = Number.parseInt(v, 10)
						const numCtx = Number.isFinite(contextWindow) && contextWindow > 0 ? contextWindow : undefined
						// The debounced input also fires for its initial value and
						// external prop syncs — only persist actual changes.
						const currentNumCtx = Number.isFinite(ollamaNumCtx) && ollamaNumCtx > 0 ? ollamaNumCtx : undefined
						if (numCtx === currentNumCtx) {
							return
						}
						// Persist to providers.json (`contextWindow`); the store
						// mirrors the value to the legacy state key for older
						// readers. Zero clears the setting.
						void write({ contextWindow: numCtx ?? 0 }).catch((error) =>
							console.error("Failed to update Ollama context window:", error),
						)

						// Clear tuned state and mirror context number to state so stale autotune state doesn't override manual setting
						void handleFieldsChange({
							ollamaIsTuned: false,
							ollamaTunedContextSize: undefined,
							ollamaTunedModel: undefined,
							ollamaApiOptionsCtxNum: numCtx ? String(numCtx) : undefined,
						}).catch((error) => console.error("Failed to update Ollama context fields:", error))

						if (selectedModel.modelId) {
							void commitModelSelection({
								modelId: selectedModel.modelId,
								overrides: { contextWindow: numCtx },
								modelInfo: {
									...openAiModelInfoSafeDefaults,
									name: selectedModel.modelId,
									...(numCtx ? { contextWindow: numCtx } : {}),
								},
							}).catch((error) => console.error("Failed to update Ollama context window:", error))
						}
					}}
					placeholder={"Default: 32768"}
					style={{ width: "100%" }}>
					<span className="font-semibold">Model Context Window</span>
				</DebouncedTextField>
			)}

			{showModelOptions && (
				<>
					{/* Temperature */}
					<DebouncedTextField
						initialValue={
							apiConfiguration?.ollamaTemperature !== undefined
								? String(apiConfiguration.ollamaTemperature)
								: "0.8"
						}
						onChange={(value) => {
							const numValue = Number.parseFloat(value)
							if (!Number.isNaN(numValue) && numValue >= 0 && numValue <= 2) {
								handleFieldChange("ollamaTemperature", Math.round(numValue * 10) / 10)
							}
						}}
						placeholder="Default: 0.8"
						style={{ width: "100%" }}>
						<span className="font-semibold">Temperature (0.0 - 2.0)</span>
					</DebouncedTextField>
					<p className="text-xs mt-0 text-description">
						Controls output randomness. 0.0 is deterministic and focused; higher values increase variety.
					</p>

					{/* Min-P Sampling */}
					<DebouncedTextField
						initialValue={
							apiConfiguration?.ollamaMinP !== undefined ? String(apiConfiguration.ollamaMinP) : "0.00"
						}
						onChange={(value) => {
							const numValue = Number.parseFloat(value)
							if (!Number.isNaN(numValue) && numValue >= 0 && numValue <= 1) {
								handleFieldChange("ollamaMinP", Math.round(numValue * 100) / 100)
							}
						}}
						placeholder="Default: 0.00"
						style={{ width: "100%" }}>
						<span className="font-semibold">Min-P Sampling (0.00 - 1.00)</span>
					</DebouncedTextField>
					<p className="text-xs mt-0 text-description">
						Filters tokens with probability relative to the most likely token (0.00 = disabled).
					</p>

					{/* Deterministic Seed */}
					<div className="flex flex-col gap-1 mt-1">
						<span className="font-semibold text-xs">Deterministic Seed</span>
						<div className="flex items-center gap-2">
							<VSCodeCheckbox
								checked={apiConfiguration?.ollamaSeedEnabled ?? false}
								onChange={(e: any) => {
									const checked = (e.target as HTMLInputElement).checked
									handleFieldChange("ollamaSeedEnabled", checked)
								}}>
								Enable fixed seed
							</VSCodeCheckbox>
							{apiConfiguration?.ollamaSeedEnabled && (
								<DebouncedTextField
									initialValue={
										apiConfiguration?.ollamaSeedValue !== undefined
											? String(apiConfiguration.ollamaSeedValue)
											: "42"
									}
									onChange={(value) => {
										const numValue = Number.parseInt(value, 10)
										if (!Number.isNaN(numValue) && numValue >= 0) {
											handleFieldChange("ollamaSeedValue", numValue)
										}
									}}
									placeholder="42"
									style={{ width: "90px" }}
								/>
							)}
						</div>
						<p className="text-xs mt-0 text-description">
							Fixes the random seed for reproducible completions across sessions.
						</p>
					</div>

					{/* Reasoning / Thinking Mode */}
					<div className="flex flex-col gap-1 mt-1">
						<span className="font-semibold text-xs">Reasoning / Thinking Mode</span>
						<VSCodeCheckbox
							checked={apiConfiguration?.ollamaReasoning ?? true}
							onChange={(e: any) => {
								const checked = (e.target as HTMLInputElement).checked
								handleFieldChange("ollamaReasoning", checked)
							}}>
							Enable thinking output for reasoning models
						</VSCodeCheckbox>
						<p className="text-xs mt-0 text-description">
							Allows models with native reasoning capabilities to output thinking thoughts.
						</p>
					</div>

					{/* Tuned Status Indicator */}
					{apiConfiguration?.ollamaIsTuned && (
						<div className="flex items-center gap-2 p-2 mt-1 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-mono">
							<span className="font-semibold">✓ Calibrated:</span>
							<span>
								{apiConfiguration.ollamaTunedModel ? `${apiConfiguration.ollamaTunedModel} ` : ""}
								tuned to {apiConfiguration.ollamaTunedContextSize ? `${Number(apiConfiguration.ollamaTunedContextSize).toLocaleString()} tokens` : "100% GPU"}
							</span>
						</div>
					)}

					<DebouncedTextField
						initialValue={apiConfiguration?.requestTimeoutMs ? apiConfiguration.requestTimeoutMs.toString() : "300000"}
						onChange={(value) => {
							// Convert to number, with validation
							const numValue = Number.parseInt(value, 10)
							if (!Number.isNaN(numValue) && numValue > 0) {
								handleFieldChange("requestTimeoutMs", numValue)
							}
						}}
						placeholder="Default: 300000 (5 minutes)"
						style={{ width: "100%" }}>
						<span className="font-semibold">Request Timeout (ms)</span>
					</DebouncedTextField>
					<p className="text-xs mt-0 text-description">
						Maximum time in milliseconds to wait for API responses before timing out.
					</p>
				</>
			)}

			<p
				style={{
					fontSize: "12px",
					marginTop: "5px",
					color: "var(--vscode-descriptionForeground)",
				}}>
				Ollama allows you to run models locally on your computer. For instructions on how to get started, see their{" "}
				<VSCodeLink
					href="https://github.com/ollama/ollama/blob/main/README.md"
					style={{ display: "inline", fontSize: "inherit" }}>
					quickstart guide.
				</VSCodeLink>{" "}
				<span style={{ color: "var(--vscode-errorForeground)" }}>
					(<span style={{ fontWeight: 500 }}>Note:</span> Cline uses complex prompts, so behavior can vary across
					models. Less capable models may not work as expected.)
				</span>
			</p>
		</div>
	)
}

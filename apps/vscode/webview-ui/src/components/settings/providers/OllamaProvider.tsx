import { openAiModelInfoSafeDefaults } from "@shared/api"
import { StringRequest } from "@shared/proto/cline/common"
import { ReloadOllamaModelRequest } from "@shared/proto/cline/models"
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

const COMMON_CONTEXT_PRESETS = [512, 2048, 4096, 8192, 32768]

/**
 * The Ollama provider configuration component
 */
export const OllamaProvider = ({ showModelOptions, isPopup, currentMode }: OllamaProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange, handleFieldsChange } = useApiConfigurationHandlers()
	const { config, write, commitSelection } = useProviderConfig("ollama")

	const [ollamaModels, setOllamaModels] = useState<string[]>([])
	const [isPreloading, setIsPreloading] = useState(false)
	const [preloadStatus, setPreloadStatus] = useState<string | null>(null)

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

	const handleApplyContextWindow = useCallback(
		(numCtx: number | undefined) => {
			void write({ contextWindow: numCtx ?? 0 }).catch((error) =>
				console.error("Failed to update Ollama context window:", error),
			)
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
		},
		[write, handleFieldsChange, selectedModel.modelId, commitModelSelection],
	)

	const handlePreloadModel = useCallback(async () => {
		const targetModel = selectedModel.modelId?.trim()
		if (!targetModel || !ollamaBaseUrl) return
		setIsPreloading(true)
		setPreloadStatus(null)
		try {
			await ModelsServiceClient.reloadOllamaModel(
				ReloadOllamaModelRequest.create({
					baseUrl: ollamaBaseUrl,
					modelName: targetModel,
					contextWindow: Number.isFinite(ollamaNumCtx) && ollamaNumCtx > 0 ? ollamaNumCtx : 0,
					numGpu:
						typeof apiConfiguration?.ollamaNumGpu === "number"
							? apiConfiguration.ollamaNumGpu
							: 99,
					numPredict:
						typeof apiConfiguration?.ollamaNumPredict === "number"
							? apiConfiguration.ollamaNumPredict
							: undefined,
					keepAlive: "10m",
				}),
			)
			setPreloadStatus("Model preloaded in VRAM (keep_alive: 10m)")
			setTimeout(() => setPreloadStatus(null), 4000)
		} catch (error) {
			console.error("Failed to preload Ollama model:", error)
			setPreloadStatus("Preload failed")
			setTimeout(() => setPreloadStatus(null), 4000)
		} finally {
			setIsPreloading(false)
		}
	}, [
		selectedModel.modelId,
		ollamaBaseUrl,
		ollamaNumCtx,
		apiConfiguration?.ollamaNumGpu,
		apiConfiguration?.ollamaNumPredict,
	])

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
				<div>
					<DebouncedTextField
						initialValue={Number.isFinite(ollamaNumCtx) && ollamaNumCtx > 0 ? String(ollamaNumCtx) : ""}
						onChange={(v) => {
							const contextWindow = Number.parseInt(v, 10)
							const numCtx = Number.isFinite(contextWindow) && contextWindow > 0 ? contextWindow : undefined
							const currentNumCtx = Number.isFinite(ollamaNumCtx) && ollamaNumCtx > 0 ? ollamaNumCtx : undefined
							if (numCtx === currentNumCtx) {
								return
							}
							handleApplyContextWindow(numCtx)
						}}
						placeholder={"Default: 32768"}
						style={{ width: "100%" }}>
						<span className="font-semibold">Model Context Window</span>
					</DebouncedTextField>
					<div className="flex flex-wrap items-center gap-1.5 mt-1.5">
						<span className="text-xs text-description">Presets:</span>
						{COMMON_CONTEXT_PRESETS.map((preset) => (
							<button
								key={preset}
								type="button"
								className={`px-1.5 py-0.5 text-xs rounded border transition-colors cursor-pointer ${
									ollamaNumCtx === preset
										? "bg-[var(--vscode-button-secondaryBackground)] text-[var(--vscode-button-secondaryForeground)] border-transparent font-semibold"
										: "bg-transparent border-[var(--vscode-input-border)] text-[var(--vscode-descriptionForeground)] hover:text-[var(--vscode-foreground)]"
								}`}
								onClick={() => handleApplyContextWindow(preset)}>
								{preset >= 1024 ? `${preset / 1024}K` : preset}
							</button>
						))}
					</div>
				</div>
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
							if (value.trim() === "") {
								void handleFieldChange("ollamaTemperature", undefined)
								return
							}
							const numValue = Number.parseFloat(value)
							if (!Number.isNaN(numValue) && numValue >= 0 && numValue <= 2) {
								void handleFieldChange("ollamaTemperature", Math.round(numValue * 10) / 10)
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

					{/* Top-P Nucleus Sampling */}
					<DebouncedTextField
						initialValue={
							apiConfiguration?.ollamaTopP !== undefined ? String(apiConfiguration.ollamaTopP) : "0.90"
						}
						onChange={(value) => {
							const numValue = Number.parseFloat(value)
							if (!Number.isNaN(numValue) && numValue >= 0 && numValue <= 1) {
								handleFieldChange("ollamaTopP", Math.round(numValue * 100) / 100)
							}
						}}
						placeholder="Typical: 0.90 - 0.95 (default 0.90)"
						style={{ width: "100%" }}>
						<span className="font-semibold">Top-P Nucleus Sampling (0.00 - 1.00)</span>
					</DebouncedTextField>
					<p className="text-xs mt-0 text-description">
						Nucleus sampling. Accumulates the most likely tokens until their combined probability reaches this threshold (e.g., top 95%).
					</p>

					{/* Top-K Sampling */}
					<DebouncedTextField
						initialValue={
							apiConfiguration?.ollamaTopK !== undefined ? String(apiConfiguration.ollamaTopK) : "40"
						}
						onChange={(value) => {
							const numValue = Number.parseInt(value, 10)
							if (!Number.isNaN(numValue) && numValue >= 0) {
								handleFieldChange("ollamaTopK", numValue)
							}
						}}
						placeholder="Typical: 40 - 50 (default 40)"
						style={{ width: "100%" }}>
						<span className="font-semibold">Top-K Sampling (0 - 100+)</span>
					</DebouncedTextField>
					<p className="text-xs mt-0 text-description">
						Limits the pool of potential next words to strictly the top "K" most probable choices (0 = disabled).
					</p>

					{/* Repeat Penalty */}
					<DebouncedTextField
						initialValue={
							apiConfiguration?.ollamaRepeatPenalty !== undefined
								? String(apiConfiguration.ollamaRepeatPenalty)
								: "1.10"
						}
						onChange={(value) => {
							const numValue = Number.parseFloat(value)
							if (!Number.isNaN(numValue) && numValue >= 0 && numValue <= 2) {
								handleFieldChange("ollamaRepeatPenalty", Math.round(numValue * 100) / 100)
							}
						}}
						placeholder="Typical: 1.00 - 1.20 (default 1.10)"
						style={{ width: "100%" }}>
						<span className="font-semibold">Repeat Penalty (0.00 - 2.00)</span>
					</DebouncedTextField>
					<p className="text-xs mt-0 text-description">
						Penalizes tokens that have already appeared recently to prevent the model from getting stuck in repetitive loops.
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

					{/* Max Generation Tokens (num_predict) */}
					<DebouncedTextField
						initialValue={
							apiConfiguration?.ollamaNumPredict !== undefined
								? String(apiConfiguration.ollamaNumPredict)
								: ""
						}
						onChange={(value) => {
							if (value.trim() === "") {
								void handleFieldChange("ollamaNumPredict", undefined)
								try {
									localStorage.removeItem("cline:ollama:numPredict")
								} catch {}
								return
							}
							const numValue = Number.parseInt(value, 10)
							if (!Number.isNaN(numValue)) {
								void handleFieldChange("ollamaNumPredict", numValue)
								try {
									localStorage.setItem("cline:ollama:numPredict", String(numValue))
								} catch {}
							}
						}}
						placeholder="Default: Ollama default (-1 for unlimited, e.g. 128)"
						style={{ width: "100%" }}>
						<span className="font-semibold">Max Generation Tokens (num_predict)</span>
					</DebouncedTextField>
					<p className="text-xs mt-0 text-description">
						Maximum number of tokens to predict when generating text (-1 for unlimited).
					</p>

					{/* GPU Offload Layers (num_gpu) */}
					<div className="flex flex-col gap-1 mt-1">
						<span className="font-semibold text-xs">GPU Offload Layers (num_gpu)</span>
						<div className="flex items-center gap-2">
							<VSCodeCheckbox
								checked={apiConfiguration?.ollamaNumGpu === undefined || apiConfiguration.ollamaNumGpu >= 99}
								onChange={(e: any) => {
									const checked = (e.target as HTMLInputElement).checked
									const val = checked ? 99 : 0
									void handleFieldChange("ollamaNumGpu", val)
									try {
										localStorage.setItem("cline:ollama:numGpu", String(val))
									} catch {}
								}}>
								Full GPU Offload (99 layers)
							</VSCodeCheckbox>
							{apiConfiguration?.ollamaNumGpu !== undefined && apiConfiguration.ollamaNumGpu < 99 && (
								<DebouncedTextField
									initialValue={String(apiConfiguration.ollamaNumGpu)}
									onChange={(value) => {
										const numValue = Number.parseInt(value, 10)
										if (!Number.isNaN(numValue) && numValue >= 0) {
											void handleFieldChange("ollamaNumGpu", numValue)
											try {
												localStorage.setItem("cline:ollama:numGpu", String(numValue))
											} catch {}
										}
									}}
									placeholder="0"
									style={{ width: "90px" }}
								/>
							)}
						</div>
						<p className="text-xs mt-0 text-description">
							Number of model layers to offload onto GPU (default: 99 offloads all layers).
						</p>
					</div>

					{/* Preload Model into VRAM */}
					<div className="flex flex-col gap-1.5 mt-2 p-2 rounded border border-[var(--vscode-input-border)] bg-[var(--vscode-editor-background)]">
						<div className="flex items-center justify-between">
							<span className="font-semibold text-xs">Model Warm-Up / Preload</span>
							{preloadStatus && (
								<span className="text-xs text-emerald-400 font-mono">{preloadStatus}</span>
							)}
						</div>
						<div className="flex items-center gap-2">
							<button
								type="button"
								disabled={isPreloading || !selectedModel.modelId}
								onClick={handlePreloadModel}
								className="px-2.5 py-1 text-xs font-medium rounded bg-[var(--vscode-button-secondaryBackground)] hover:bg-[var(--vscode-button-secondaryHoverBackground)] text-[var(--vscode-button-secondaryForeground)] transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5 border-0">
								{isPreloading ? (
									<>
										<span className="inline-block animate-spin">⏳</span>
										<span>Preloading {selectedModel.modelId}...</span>
									</>
								) : (
									<>
										<span>⚡</span>
										<span>Preload Model into VRAM</span>
									</>
								)}
							</button>
							<span className="text-xs text-description">
								Loads model weights into VRAM with keep_alive: 10m without generating tokens.
							</span>
						</div>
					</div>
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

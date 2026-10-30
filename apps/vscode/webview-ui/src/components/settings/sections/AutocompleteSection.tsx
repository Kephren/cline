import { StringRequest } from "@shared/proto/cline/common"
import { ReloadOllamaModelRequest, UnloadOllamaModelRequest } from "@shared/proto/cline/models"
import { VSCodeButton, VSCodeCheckbox, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { CpuIcon, PowerOffIcon, ZapIcon } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useProviderConfig } from "@/hooks/useProviderConfig"
import { ModelsServiceClient } from "@/services/grpc-client"
import OllamaModelPicker from "../OllamaModelPicker"
import Section from "../Section"
import { updateSetting } from "../utils/settingsHandlers"

interface AutocompleteSectionProps {
	renderSectionHeader: (tabId: string) => JSX.Element | null
}

const COMMON_CONTEXT_PRESETS = [2048, 4096, 8192, 16384, 32768, 65536]

export const AutocompleteSection = ({ renderSectionHeader }: AutocompleteSectionProps) => {
	const {
		autocompleteEnabled = true,
		autocompleteShareWithChat = true,
		autocompleteBaseUrl,
		autocompleteApiKey,
		autocompleteModelId,
		autocompleteNumCtx,
		autocompleteRequestTimeoutMs,
		autocompleteThink = false,
		apiConfiguration,
	} = useExtensionState()

	const { config: chatOllamaConfig } = useProviderConfig("ollama")
	const [ollamaModels, setOllamaModels] = useState<string[]>([])
	const [isLoadingModels, setIsLoadingModels] = useState(false)
	const isMountedRef = useRef(true)

	useEffect(() => {
		isMountedRef.current = true
		return () => {
			isMountedRef.current = false
		}
	}, [])

	const effectiveBaseUrl = (
		autocompleteShareWithChat
			? chatOllamaConfig?.baseUrl || apiConfiguration?.ollamaBaseUrl || "http://localhost:11434"
			: autocompleteBaseUrl || "http://localhost:11434"
	).replace(/\/+$/, "")

	const fetchModels = useCallback(async (url: string) => {
		try {
			if (isMountedRef.current) setIsLoadingModels(true)
			const response = await ModelsServiceClient.getOllamaModels(
				StringRequest.create({
					value: url || "",
				}),
			)
			if (response?.values && isMountedRef.current) {
				setOllamaModels(response.values)
			}
		} catch (error) {
			console.error("Failed to fetch Ollama models in AutocompleteSection:", error)
		} finally {
			if (isMountedRef.current) {
				setIsLoadingModels(false)
			}
		}
	}, [])

	useEffect(() => {
		if (effectiveBaseUrl) {
			void fetchModels(effectiveBaseUrl)
		}
	}, [effectiveBaseUrl, fetchModels])

	const [isPreloading, setIsPreloading] = useState(false)
	const [isUnloading, setIsUnloading] = useState(false)
	const [preloadStatus, setPreloadStatus] = useState<string | null>(null)
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

	const effectiveModelId = (
		autocompleteShareWithChat
			? chatOllamaConfig?.actSelection?.modelId ||
				chatOllamaConfig?.planSelection?.modelId ||
				apiConfiguration?.actModeOllamaModelId ||
				apiConfiguration?.planModeOllamaModelId ||
				apiConfiguration?.actModeApiModelId ||
				apiConfiguration?.planModeApiModelId ||
				""
			: autocompleteModelId || ""
	).trim()

	const effectiveNumCtx = autocompleteShareWithChat
		? chatOllamaConfig?.contextWindow ||
			(apiConfiguration?.ollamaApiOptionsCtxNum
				? Number.parseInt(apiConfiguration.ollamaApiOptionsCtxNum, 10)
				: undefined) ||
			65536
		: autocompleteNumCtx || 65536

	const requestOllamaStatus = useCallback(
		async (overrideUrl?: string) => {
			const targetUrl = (overrideUrl || effectiveBaseUrl)?.trim()
			if (!targetUrl) return
			try {
				const res = await ModelsServiceClient.getOllamaModelStatus(
					StringRequest.create({
						value: targetUrl,
					}),
				)
				if (res && isMountedRef.current) {
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
				console.error("Failed to fetch Ollama model status in AutocompleteSection:", error)
			}
		},
		[effectiveBaseUrl],
	)

	useEffect(() => {
		if (effectiveBaseUrl) {
			void requestOllamaStatus(effectiveBaseUrl)
		}
	}, [effectiveBaseUrl, requestOllamaStatus])

	const handlePreload = useCallback(async () => {
		const targetModel = (effectiveModelId || ollamaStatus.modelName)?.trim()
		if (!targetModel || !effectiveBaseUrl) return
		setIsPreloading(true)
		setPreloadStatus(null)
		try {
			await ModelsServiceClient.reloadOllamaModel(
				ReloadOllamaModelRequest.create({
					baseUrl: effectiveBaseUrl,
					modelName: targetModel,
					contextWindow: Number.isFinite(effectiveNumCtx) && effectiveNumCtx > 0 ? effectiveNumCtx : 65536,
					keepAlive: "-1",
				}),
			)
			if (isMountedRef.current) {
				setPreloadStatus("Preloaded")
				await requestOllamaStatus()
				setTimeout(() => {
					if (isMountedRef.current) setPreloadStatus(null)
				}, 3000)
			}
		} catch (error) {
			console.error("Failed to preload model in AutocompleteSection:", error)
			if (isMountedRef.current) {
				setPreloadStatus("Failed")
				setTimeout(() => {
					if (isMountedRef.current) setPreloadStatus(null)
				}, 3000)
			}
		} finally {
			if (isMountedRef.current) {
				setIsPreloading(false)
			}
		}
	}, [effectiveModelId, effectiveBaseUrl, effectiveNumCtx, ollamaStatus.modelName, requestOllamaStatus])

	const handleUnload = useCallback(async () => {
		if (!effectiveBaseUrl) return
		setIsUnloading(true)
		try {
			await ModelsServiceClient.unloadOllamaModel(
				UnloadOllamaModelRequest.create({
					baseUrl: effectiveBaseUrl,
					modelName: effectiveModelId || ollamaStatus.modelName || "",
				}),
			)
			if (isMountedRef.current) {
				await requestOllamaStatus()
			}
		} catch (error) {
			console.error("Failed to unload model in AutocompleteSection:", error)
		} finally {
			if (isMountedRef.current) {
				setIsUnloading(false)
			}
		}
	}, [effectiveBaseUrl, effectiveModelId, ollamaStatus.modelName, requestOllamaStatus])

	const handleCopyFromChat = useCallback(() => {
		const chatBaseUrl =
			chatOllamaConfig?.baseUrl || apiConfiguration?.ollamaBaseUrl || "http://localhost:11434"
		const chatModelId =
			chatOllamaConfig?.actSelection?.modelId ||
			chatOllamaConfig?.planSelection?.modelId ||
			apiConfiguration?.actModeOllamaModelId ||
			apiConfiguration?.planModeOllamaModelId ||
			apiConfiguration?.actModeApiModelId ||
			apiConfiguration?.planModeApiModelId ||
			""
		const chatCtx =
			chatOllamaConfig?.contextWindow ||
			(apiConfiguration?.ollamaApiOptionsCtxNum
				? Number.parseInt(apiConfiguration.ollamaApiOptionsCtxNum, 10)
				: undefined) ||
			apiConfiguration?.ollamaTunedContextSize ||
			4096
		const chatTimeout = apiConfiguration?.requestTimeoutMs || 5000
		const chatThink = apiConfiguration?.ollamaReasoning ?? false

		updateSetting("autocompleteShareWithChat", false)
		updateSetting("autocompleteBaseUrl", chatBaseUrl)
		updateSetting("autocompleteModelId", chatModelId)
		updateSetting("autocompleteNumCtx", Number.isFinite(chatCtx) ? chatCtx : 65536)
		updateSetting("autocompleteRequestTimeoutMs", chatTimeout)
		updateSetting("autocompleteThink", chatThink)
	}, [chatOllamaConfig, apiConfiguration])

	return (
		<div>
			{renderSectionHeader("autocomplete")}
			<Section>
				<p className="text-sm text-description mb-4">
					Cline can provide inline ghost-text code autocompletions in the editor powered by your local Ollama models.
				</p>

				{/* Enable / Disable */}
				<div className="mb-4">
					<VSCodeCheckbox
						checked={autocompleteEnabled}
						onChange={(e: any) => updateSetting("autocompleteEnabled", e.target.checked === true)}>
						Enable Inline Autocomplete
					</VSCodeCheckbox>
					<p className="text-xs text-description mt-1">
						Show grey inline suggestions while typing in any open code editor.
					</p>
				</div>

				{/* Share settings with Chat */}
				<div className="mb-4">
					<VSCodeCheckbox
						checked={autocompleteShareWithChat}
						onChange={(e: any) => updateSetting("autocompleteShareWithChat", e.target.checked === true)}>
						Share settings with Chat model
					</VSCodeCheckbox>
					<p className="text-xs text-description mt-1">
						When enabled, autocomplete uses the Ollama model, URL, and credentials configured for Chat.
					</p>
				</div>

				{/* Copy from Chat Button */}
				<div className="mb-4">
					<VSCodeButton appearance="secondary" onClick={handleCopyFromChat}>
						Copy settings from Chat
					</VSCodeButton>
					<p className="text-xs text-description mt-1">
						Copies current Chat Ollama settings to standalone autocomplete configuration.
					</p>
				</div>

				{autocompleteShareWithChat ? (
					<div className="p-3 rounded border border-[var(--vscode-input-border)] bg-[var(--vscode-editor-inactiveSelectionBackground)] text-xs space-y-1 mb-4">
						<div className="font-semibold text-sm mb-1">Active Shared Chat Configuration</div>
						<div>
							<span className="text-description">Base URL: </span>
							<span>
								{chatOllamaConfig?.baseUrl ||
									apiConfiguration?.ollamaBaseUrl ||
									"http://localhost:11434 (default)"}
							</span>
						</div>
						<div>
							<span className="text-description">Model ID: </span>
							<span>
								{chatOllamaConfig?.actSelection?.modelId ||
									chatOllamaConfig?.planSelection?.modelId ||
									apiConfiguration?.actModeOllamaModelId ||
									apiConfiguration?.planModeOllamaModelId ||
									apiConfiguration?.actModeApiModelId ||
									apiConfiguration?.planModeApiModelId ||
									"Not selected (configure in Chat)"}
							</span>
						</div>
						<div>
							<span className="text-description">Context Window: </span>
							<span>
								{chatOllamaConfig?.contextWindow
									? `${chatOllamaConfig.contextWindow}`
									: apiConfiguration?.ollamaApiOptionsCtxNum ||
										"Default (65536)"}
							</span>
						</div>
						<div>
							<span className="text-description">Think (Reasoning): </span>
							<span>
								{apiConfiguration?.ollamaReasoning !== undefined
									? apiConfiguration.ollamaReasoning
										? "Enabled"
										: "Disabled"
									: "Disabled (default)"}
							</span>
						</div>
					</div>
				) : (
					<div className="space-y-4 border-t border-[var(--vscode-input-border)] pt-4">
						<div className="font-semibold text-sm">Standalone Autocomplete Configuration</div>

						{/* Base URL */}
						<div>
							<label className="block text-xs font-semibold mb-1">Base URL</label>
							<VSCodeTextField
								value={autocompleteBaseUrl || ""}
								placeholder="http://localhost:11434"
								onInput={(e: any) => updateSetting("autocompleteBaseUrl", e.target.value.trim())}
								style={{ width: "100%" }}
							/>
							<p className="text-xs text-description mt-0.5">The URL of your local Ollama instance.</p>
						</div>

						{/* API Key */}
						<div>
							<label className="block text-xs font-semibold mb-1">API Key (Optional)</label>
							<VSCodeTextField
								type="password"
								value={autocompleteApiKey || ""}
								placeholder="Enter API Key if required"
								onInput={(e: any) => updateSetting("autocompleteApiKey", e.target.value)}
								style={{ width: "100%" }}
							/>
						</div>

						{/* Model ID */}
						<div>
							<div className="flex items-center justify-between mb-1">
								<label className="block text-xs font-semibold">Model ID</label>
								<button
									type="button"
									disabled={isLoadingModels}
									onClick={() => void fetchModels(effectiveBaseUrl)}
									className="text-xs text-link hover:underline bg-transparent border-0 cursor-pointer p-0">
									{isLoadingModels ? "Refreshing..." : "Refresh models"}
								</button>
							</div>
							<OllamaModelPicker
								ollamaModels={ollamaModels}
								selectedModelId={autocompleteModelId || ""}
								onModelChange={(modelId) => updateSetting("autocompleteModelId", modelId)}
								onFocus={() => void fetchModels(effectiveBaseUrl)}
								placeholder="Search and select an Ollama model..."
							/>
							{ollamaModels.length > 0 && (
								<div className="flex flex-wrap items-center gap-1.5 mt-2">
									<span className="text-xs text-description">Installed:</span>
									{ollamaModels.map((model) => (
										<button
											key={model}
											type="button"
											className={`px-1.5 py-0.5 text-xs rounded border transition-colors cursor-pointer ${
												autocompleteModelId === model
													? "bg-[var(--vscode-button-secondaryBackground)] text-[var(--vscode-button-secondaryForeground)] border-transparent font-semibold"
													: "bg-transparent border-[var(--vscode-input-border)] text-[var(--vscode-descriptionForeground)] hover:text-[var(--vscode-foreground)]"
											}`}
											onClick={() => updateSetting("autocompleteModelId", model)}>
											{model}
										</button>
									))}
								</div>
							)}
						</div>

						{/* Context Window */}
						<div>
							<label className="block text-xs font-semibold mb-1">Context Window (num_ctx)</label>
							<VSCodeTextField
								value={autocompleteNumCtx ? String(autocompleteNumCtx) : ""}
								placeholder="Default: 65536"
								onInput={(e: any) => {
									const val = Number.parseInt(e.target.value, 10)
									updateSetting("autocompleteNumCtx", Number.isFinite(val) && val > 0 ? val : undefined)
								}}
								style={{ width: "100%" }}
							/>
							<div className="flex flex-wrap items-center gap-1.5 mt-1.5">
								<span className="text-xs text-description">Presets:</span>
								{COMMON_CONTEXT_PRESETS.map((preset) => (
									<button
										key={preset}
										type="button"
										className={`px-1.5 py-0.5 text-xs rounded border transition-colors cursor-pointer ${
											autocompleteNumCtx === preset
												? "bg-[var(--vscode-button-secondaryBackground)] text-[var(--vscode-button-secondaryForeground)] border-transparent font-semibold"
												: "bg-transparent border-[var(--vscode-input-border)] text-[var(--vscode-descriptionForeground)] hover:text-[var(--vscode-foreground)]"
										}`}
										onClick={() => updateSetting("autocompleteNumCtx", preset)}>
										{preset >= 1024 ? `${preset / 1024}K` : preset}
									</button>
								))}
							</div>
							<p className="text-xs text-description mt-1">
								Context window size in tokens allocated for autocomplete completions.
							</p>
						</div>

						{/* Request Timeout */}
						<div>
							<label className="block text-xs font-semibold mb-1">Request Timeout (ms)</label>
							<VSCodeTextField
								value={autocompleteRequestTimeoutMs ? String(autocompleteRequestTimeoutMs) : ""}
								placeholder="Default: 5000"
								onInput={(e: any) => {
									const val = Number.parseInt(e.target.value, 10)
									updateSetting(
										"autocompleteRequestTimeoutMs",
										Number.isFinite(val) && val > 0 ? val : undefined,
									)
								}}
								style={{ width: "100%" }}
							/>
							<p className="text-xs text-description mt-0.5">
								Maximum time in milliseconds to wait for a completion before cancelling.
							</p>
						</div>

						{/* Think Option */}
						<div>
							<VSCodeCheckbox
								checked={autocompleteThink}
								onChange={(e: any) => updateSetting("autocompleteThink", e.target.checked === true)}>
								Enable Think / Reasoning
							</VSCodeCheckbox>
							<p className="text-xs text-description mt-0.5">
								Enables reasoning thinking tokens on supported models (e.g. DeepSeek-R1). Disabled by default for faster ghost-text completions.
							</p>
						</div>
					</div>
				)}

				{/* Ollama hardware & lifecycle controls (matching Chat Area) */}
				<div className="mt-4 p-2.5 rounded border border-[var(--vscode-input-border)] bg-[var(--vscode-editor-inactiveSelectionBackground)] flex flex-wrap items-center justify-between gap-2 text-xs">
					<div className="flex items-center gap-2">
						{/* GPU/CPU Ratio Badge */}
						{(() => {
							const isRunning = ollamaStatus.isRunning
							const gpuPercent = isRunning ? ollamaStatus.gpuPercent : 100
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
									className="flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-mono select-none text-white transition-colors"
									data-testid="gpu-cpu-ratio"
									style={{ backgroundColor: ratioBg }}
									title={
										isRunning
											? `Ollama Active Model: ${ollamaStatus.modelName || effectiveModelId}\nVRAM: ${(Number(ollamaStatus.sizeVram) / (1024 * 1024 * 1024)).toFixed(2)} GB / ${(Number(ollamaStatus.size) / (1024 * 1024 * 1024)).toFixed(2)} GB (${ollamaStatus.gpuPercent}% GPU / ${ollamaStatus.cpuPercent}% CPU)`
											: "Ollama: Ready / Idle (loads weights into VRAM on generation)"
									}>
									<CpuIcon size={12} />
									<span>
										{isRunning
											? `GPU: ${ollamaStatus.gpuPercent}%${vramGb ? ` (${vramGb} GB)` : ""}`
											: "GPU: 100% (Idle)"}
									</span>
								</div>
							)
						})()}

						{/* Free VRAM (Unload) Button */}
						<button
							aria-label="Free VRAM"
							className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-mono transition-colors cursor-pointer select-none bg-[var(--vscode-button-secondaryBackground)] hover:bg-[var(--vscode-button-secondaryHoverBackground)] text-[var(--vscode-button-secondaryForeground)] border-0 disabled:opacity-40 disabled:cursor-not-allowed"
							data-testid="unload-ollama-model-button"
							disabled={isUnloading || (!ollamaStatus.isRunning && !ollamaStatus.modelName)}
							onClick={handleUnload}
							title={
								ollamaStatus.isRunning
									? `Unload ${ollamaStatus.modelName || effectiveModelId} and free VRAM (${(Number(ollamaStatus.sizeVram) / (1024 * 1024 * 1024)).toFixed(2)} GB)`
									: "No model currently loaded in VRAM"
							}
							type="button">
							<PowerOffIcon className={isUnloading ? "animate-spin" : ""} size={12} />
							<span>Unload</span>
						</button>

						{/* Preload / Warmup Button */}
						<button
							aria-label="Preload model into VRAM"
							className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-mono transition-colors cursor-pointer select-none bg-[var(--vscode-button-secondaryBackground)] hover:bg-[var(--vscode-button-secondaryHoverBackground)] text-[var(--vscode-button-secondaryForeground)] border border-transparent disabled:opacity-40 disabled:cursor-not-allowed"
							data-testid="ollama-preload-button"
							disabled={isPreloading || !effectiveModelId}
							onClick={handlePreload}
							title="Preload Model: Issue lightweight request with keep_alive: 30m to warm up weights and KV cache in VRAM"
							type="button">
							<ZapIcon className={isPreloading ? "animate-spin text-amber-400" : "text-amber-400"} size={12} />
							<span>{isPreloading ? "Preloading..." : preloadStatus ? preloadStatus : "Preload"}</span>
						</button>
					</div>

					{ollamaStatus.isRunning && ollamaStatus.modelName && (
						<span className="text-[11px] text-description font-mono truncate max-w-[200px]" title={ollamaStatus.modelName}>
							Active: {ollamaStatus.modelName}
						</span>
					)}
				</div>
			</Section>
		</div>
	)
}

export default AutocompleteSection

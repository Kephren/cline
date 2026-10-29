export interface AutocompleteConfig {
	enabled: boolean
	baseUrl: string
	apiKey?: string
	modelId?: string
	numCtx: number
	requestTimeoutMs: number
	think: boolean
}

export interface StateManagerLike {
	getGlobalSettingsKey: (key: any) => any
	setGlobalState?: (key: any, value: any) => Promise<void> | void
	getSecretKey: (key: any) => Promise<string | undefined>
	getApiConfiguration?: () => any
}

export interface StateProviderLike {
	stateManager?: StateManagerLike
	controller?: {
		stateManager?: StateManagerLike
	}
}

export async function getEffectiveAutocompleteConfig(provider: StateProviderLike): Promise<AutocompleteConfig> {
	const stateManager = provider.stateManager || provider.controller?.stateManager
	const enabled = stateManager?.getGlobalSettingsKey("autocompleteEnabled") ?? true
	const shareWithChat = stateManager?.getGlobalSettingsKey("autocompleteShareWithChat") ?? true

	let ollamaFromProvidersJson: any
	try {
		const { getProviderSettingsManager } = await import("@/sdk/provider-migration")
		const manager = getProviderSettingsManager()
		const state = manager.read()
		ollamaFromProvidersJson = state.providers?.["ollama"]?.settings
	} catch {
		// Providers manager not available (e.g. during certain unit tests)
	}

	if (shareWithChat) {
		const apiConfig = stateManager?.getApiConfiguration ? stateManager.getApiConfiguration() : {}
		const rawBaseUrl =
			ollamaFromProvidersJson?.baseUrl ||
			apiConfig?.ollamaBaseUrl ||
			stateManager?.getGlobalSettingsKey("ollamaBaseUrl") ||
			"http://localhost:11434"
		const baseUrl = rawBaseUrl.replace(/\/+$/, "")
		const apiKey =
			ollamaFromProvidersJson?.apiKey ||
			apiConfig?.ollamaApiKey ||
			(stateManager ? await stateManager.getSecretKey("ollamaApiKey") : undefined) ||
			undefined
		const modelId =
			ollamaFromProvidersJson?.model ||
			apiConfig?.ollamaModelId ||
			stateManager?.getGlobalSettingsKey("actModeOllamaModelId") ||
			stateManager?.getGlobalSettingsKey("planModeOllamaModelId") ||
			stateManager?.getGlobalSettingsKey("ollamaModelId") ||
			apiConfig?.actModeApiModelId ||
			apiConfig?.planModeApiModelId ||
			stateManager?.getGlobalSettingsKey("actModeApiModelId") ||
			stateManager?.getGlobalSettingsKey("planModeApiModelId") ||
			undefined

		const chatCtxStr =
			apiConfig?.ollamaApiOptionsCtxNum ||
			(stateManager ? stateManager.getGlobalSettingsKey("ollamaApiOptionsCtxNum") : undefined)
		const tunedCtx = stateManager ? stateManager.getGlobalSettingsKey("ollamaTunedContextSize") : undefined
		const parsedCtx = chatCtxStr ? Number.parseInt(chatCtxStr, 10) : tunedCtx
		const numCtx = ollamaFromProvidersJson?.contextWindow || (Number.isFinite(parsedCtx) && parsedCtx > 0 ? parsedCtx : 65536)

		const chatTimeout =
			apiConfig?.requestTimeoutMs ||
			(stateManager ? stateManager.getGlobalSettingsKey("requestTimeoutMs") : undefined) ||
			20000

		const chatThink =
			(typeof apiConfig?.ollamaReasoning === "boolean" ? apiConfig.ollamaReasoning : undefined) ??
			(stateManager ? stateManager.getGlobalSettingsKey("ollamaReasoning") : undefined) ??
			(stateManager ? stateManager.getGlobalSettingsKey("autocompleteThink") : undefined) ??
			false

		return {
			enabled,
			baseUrl,
			apiKey,
			modelId,
			numCtx,
			requestTimeoutMs: chatTimeout,
			think: chatThink,
		}
	}

	const rawBaseUrl =
		stateManager?.getGlobalSettingsKey("autocompleteBaseUrl") || ollamaFromProvidersJson?.baseUrl || "http://localhost:11434"
	const baseUrl = rawBaseUrl.replace(/\/+$/, "")
	const apiKey =
		(stateManager ? await stateManager.getSecretKey("autocompleteApiKey") : undefined) ||
		ollamaFromProvidersJson?.apiKey ||
		undefined
	const modelId = stateManager?.getGlobalSettingsKey("autocompleteModelId") || ollamaFromProvidersJson?.model || undefined
	const numCtx = stateManager?.getGlobalSettingsKey("autocompleteNumCtx") || ollamaFromProvidersJson?.contextWindow || 65536
	const requestTimeoutMs =
		(stateManager ? stateManager.getGlobalSettingsKey("autocompleteRequestTimeoutMs") : undefined) || 20000
	const think = stateManager?.getGlobalSettingsKey("autocompleteThink") ?? false

	return {
		enabled,
		baseUrl,
		apiKey,
		modelId,
		numCtx,
		requestTimeoutMs,
		think,
	}
}

import { Empty } from "@shared/proto/cline/common"
import { ReloadOllamaModelRequest } from "@shared/proto/cline/models"
import axios from "axios"
import { parseProviderId } from "@/sdk/model-catalog/provider-id"
import { getAxiosSettings } from "@/shared/net"
import { Controller } from ".."

/**
 * Reloads a model in Ollama by first unloading it (keep_alive: 0) and then
 * requesting Ollama to load the model into memory with the specified options (num_ctx).
 * @param controller The controller instance
 * @param request The request containing base_url, model_name, and context_window
 * @returns Empty
 */
export async function reloadOllamaModel(controller: Controller, request: ReloadOllamaModelRequest): Promise<Empty> {
	try {
		let baseUrl = request.baseUrl?.trim()
		if (!baseUrl && controller && typeof controller.getProviderConfigStore === "function") {
			const store = controller.getProviderConfigStore()
			const config = store?.read(parseProviderId("ollama"))
			baseUrl = config?.baseUrl?.trim()
		}

		if (!baseUrl || !URL.canParse(baseUrl)) {
			return Empty.create({})
		}

		const axiosConfig = getAxiosSettings()

		// Discover active models from /api/ps
		const psResponse = await axios.get(`${baseUrl}/api/ps`, axiosConfig).catch(() => null)
		const runningModels: any[] = psResponse?.data?.models || []

		const modelsToUnload = new Set<string>()
		for (const m of runningModels) {
			const name = m.name || m.model
			if (name) {
				modelsToUnload.add(name)
			}
		}

		if (request.modelName) {
			modelsToUnload.add(request.modelName)
		}

		// Unload all active models by requesting keep_alive: 0
		for (const model of modelsToUnload) {
			await axios
				.post(
					`${baseUrl}/api/generate`,
					{
						model,
						keep_alive: 0,
					},
					axiosConfig,
				)
				.catch(() => null)
		}

		// Preload target model with new options (num_ctx)
		if (request.modelName) {
			const numCtx = request.contextWindow > 0 ? request.contextWindow : undefined
			await axios
				.post(
					`${baseUrl}/api/generate`,
					{
						model: request.modelName,
						prompt: "",
						stream: false,
						...(numCtx ? { options: { num_ctx: numCtx } } : {}),
					},
					axiosConfig,
				)
				.catch(() => null)
		}
	} catch (_error) {
		// Silently catch errors during reload
	}

	return Empty.create({})
}

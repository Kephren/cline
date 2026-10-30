import { Empty } from "@shared/proto/cline/common"
import { ReloadOllamaModelRequest } from "@shared/proto/cline/models"
import { Logger } from "@shared/services/Logger"
import axios from "axios"
import { parseProviderId } from "@/sdk/model-catalog/provider-id"
import { Controller } from ".."
import { getOllamaAxiosSettings, normalizeOllamaUrl } from "./ollamaUtils"

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

		const normalizedBaseUrl = normalizeOllamaUrl(baseUrl)
		if (!normalizedBaseUrl) {
			return Empty.create({})
		}

		const axiosConfig = getOllamaAxiosSettings()
		const isInfinite = request.keepAlive === "-1" || String(request.keepAlive) === "-1"

		// Only unload if keep_alive is not infinite (-1). For preload/infinite keep-alive,
		// never unload the model first (which would drop it from VRAM and force a full reload).
		if (!isInfinite) {
			// Discover active models from /api/ps
			const psResponse = await axios.get(`${normalizedBaseUrl}/api/ps`, axiosConfig).catch(() => null)
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
						`${normalizedBaseUrl}/api/generate`,
						{
							model,
							keep_alive: 0,
						},
						axiosConfig,
					)
					.catch(() => null)
			}
		}

		// Preload target model with runtime options (num_ctx, num_gpu, num_predict)
		if (request.modelName) {
			const numCtx = request.contextWindow > 0 ? request.contextWindow : undefined
			const options: Record<string, unknown> = {
				...(numCtx ? { num_ctx: numCtx } : {}),
				...(typeof request.numGpu === "number" && request.numGpu >= 0 ? { num_gpu: request.numGpu } : {}),
				...(typeof request.numPredict === "number" ? { num_predict: request.numPredict } : {}),
				...(typeof request.topP === "number" && request.topP > 0 ? { top_p: request.topP } : {}),
				...(typeof request.topK === "number" && request.topK >= 0 ? { top_k: request.topK } : {}),
				...(typeof request.repeatPenalty === "number" && request.repeatPenalty > 0
					? { repeat_penalty: request.repeatPenalty }
					: {}),
				num_batch: 512,
			}

			const keepAliveVal = isInfinite ? -1 : request.keepAlive || "10m"

			await axios
				.post(
					`${normalizedBaseUrl}/api/generate`,
					{
						model: request.modelName,
						prompt: "",
						stream: false,
						keep_alive: keepAliveVal,
						options,
					},
					{
						...axiosConfig,
						timeout: 300000, // 5 min timeout for large model preloading
					},
				)
				.catch((err) => {
					Logger.warn(`Failed to preload model in Ollama: ${err?.message || err}`)
				})
		}
	} catch (_error) {
		// Silently catch errors during reload
	}

	return Empty.create({})
}

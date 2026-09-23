import { Empty } from "@shared/proto/cline/common"
import { UnloadOllamaModelRequest } from "@shared/proto/cline/models"
import axios from "axios"
import { parseProviderId } from "@/sdk/model-catalog/provider-id"
import { getAxiosSettings } from "@/shared/net"
import { Controller } from ".."

/**
 * Unloads running model(s) from Ollama memory/VRAM by setting keep_alive: 0
 * @param controller The controller instance
 * @param request The request containing base_url and optional model_name
 * @returns Empty
 */
export async function unloadOllamaModel(controller: Controller, request: UnloadOllamaModelRequest): Promise<Empty> {
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
	} catch (_error) {
		// Silently catch errors during unload
	}

	return Empty.create({})
}

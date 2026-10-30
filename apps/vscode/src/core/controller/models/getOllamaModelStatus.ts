import { StringRequest } from "@shared/proto/cline/common"
import { OllamaModelStatusResponse } from "@shared/proto/cline/models"
import axios from "axios"
import { parseProviderId } from "@/sdk/model-catalog/provider-id"
import { Controller } from ".."
import { getOllamaAxiosSettings, normalizeOllamaUrl } from "./ollamaUtils"

/**
 * Fetches running model status from Ollama (/api/ps)
 * @param controller The controller instance
 * @param request The request containing the base URL (optional)
 * @returns OllamaModelStatusResponse with running model memory distribution (size vs size_vram)
 */
export async function getOllamaModelStatus(controller: Controller, request: StringRequest): Promise<OllamaModelStatusResponse> {
	try {
		let baseUrl: string | undefined = request.value?.trim()
		if (!baseUrl && controller && typeof controller.getProviderConfigStore === "function") {
			const store = controller.getProviderConfigStore()
			const config = store?.read(parseProviderId("ollama"))
			baseUrl = config?.baseUrl?.trim()
		}

		const normalizedBaseUrl = normalizeOllamaUrl(baseUrl)
		if (!normalizedBaseUrl) {
			return OllamaModelStatusResponse.create({ isRunning: false })
		}

		const response = await axios.get(`${normalizedBaseUrl}/api/ps`, getOllamaAxiosSettings())
		const models = response.data?.models || []
		if (models.length === 0) {
			return OllamaModelStatusResponse.create({ isRunning: false })
		}

		const activeModel = models[0]
		const size = Number(activeModel.size || 0)
		const sizeVram = Number(activeModel.size_vram || 0)

		const gpuPercent = size > 0 ? (sizeVram >= size ? 100 : Math.min(99, Math.floor((sizeVram / size) * 100))) : 0
		const cpuPercent = 100 - gpuPercent

		return OllamaModelStatusResponse.create({
			isRunning: true,
			modelName: activeModel.name || activeModel.model || "",
			size,
			sizeVram,
			gpuPercent,
			cpuPercent,
		})
	} catch (_error) {
		return OllamaModelStatusResponse.create({ isRunning: false })
	}
}

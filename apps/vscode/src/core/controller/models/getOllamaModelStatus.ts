import { StringRequest } from "@shared/proto/cline/common"
import { OllamaModelStatusResponse } from "@shared/proto/cline/models"
import axios from "axios"
import { getAxiosSettings } from "@/shared/net"
import { Controller } from ".."

/**
 * Fetches running model status from Ollama (/api/ps)
 * @param _controller The controller instance
 * @param request The request containing the base URL (optional)
 * @returns OllamaModelStatusResponse with running model memory distribution (size vs size_vram)
 */
export async function getOllamaModelStatus(_controller: Controller, request: StringRequest): Promise<OllamaModelStatusResponse> {
	try {
		const baseUrl = request.value || "http://localhost:11434"

		if (!URL.canParse(baseUrl)) {
			return OllamaModelStatusResponse.create({ isRunning: false })
		}

		const response = await axios.get(`${baseUrl}/api/ps`, getAxiosSettings())
		const models = response.data?.models || []
		if (models.length === 0) {
			return OllamaModelStatusResponse.create({ isRunning: false })
		}

		const activeModel = models[0]
		const size = Number(activeModel.size || 0)
		const sizeVram = Number(activeModel.size_vram || 0)

		const gpuPercent = size > 0 ? Math.round((sizeVram / size) * 100) : 100
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

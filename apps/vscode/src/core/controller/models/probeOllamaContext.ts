import { ProbeOllamaContextRequest, ProbeOllamaContextResponse } from "@shared/proto/cline/models"
import axios from "axios"
import { parseProviderId } from "@/sdk/model-catalog/provider-id"
import { getAxiosSettings } from "@/shared/net"
import { Controller } from ".."
import { findMatchingOllamaModel, isOllamaMemoryOrCapacityError, normalizeOllamaUrl } from "./ollamaUtils"

interface OllamaPsModel {
	name?: string
	model?: string
	size?: number
	size_vram?: number
}

/**
 * Tests if a specified context window fits 100% on the GPU for an Ollama model.
 * Issues an /api/generate probe request with prompt: "hi" and options: { num_ctx, num_predict: 1 },
 * then inspects /api/ps to verify whether size_vram == size (100% GPU offload).
 *
 * @param controller The controller instance
 * @param request ProbeOllamaContextRequest containing baseUrl, modelName, and contextWindow
 * @returns ProbeOllamaContextResponse with fitsOnGpu, gpuPercent, sizeVram, size, and optional error
 */
export async function probeOllamaContext(
	controller: Controller,
	request: ProbeOllamaContextRequest,
): Promise<ProbeOllamaContextResponse> {
	try {
		let baseUrl = request.baseUrl?.trim()
		const modelName = request.modelName?.trim()
		const contextWindow = request.contextWindow

		if (!baseUrl && controller && typeof controller.getProviderConfigStore === "function") {
			const store = controller.getProviderConfigStore()
			const config = store?.read(parseProviderId("ollama"))
			baseUrl = config?.baseUrl?.trim()
		}

		if (!baseUrl) {
			return ProbeOllamaContextResponse.create({
				success: false,
				fitsOnGpu: false,
				gpuPercent: 0,
				cpuPercent: 100,
				error: "Ollama base URL is not configured. Please configure the Ollama address in Settings.",
			})
		}

		const normalizedBaseUrl = normalizeOllamaUrl(baseUrl)
		if (!normalizedBaseUrl) {
			return ProbeOllamaContextResponse.create({
				success: false,
				fitsOnGpu: false,
				gpuPercent: 0,
				cpuPercent: 100,
				error: "Invalid base URL",
			})
		}

		if (!modelName) {
			return ProbeOllamaContextResponse.create({
				success: false,
				fitsOnGpu: false,
				gpuPercent: 0,
				cpuPercent: 100,
				error: "Model name is required",
			})
		}

		const axiosConfig = getAxiosSettings()

		// Probe Ollama by engaging the model API with the simplest prompt ("hi") and num_predict: 1.
		// keep_alive: "5m" keeps the model in memory so /api/ps can inspect its VRAM allocation.
		await axios.post(
			`${normalizedBaseUrl}/api/generate`,
			{
				model: modelName,
				prompt: "hi",
				stream: false,
				keep_alive: "5m",
				options: {
					num_ctx: Math.max(512, contextWindow),
					num_predict: 1,
					num_batch: 512,
				},
			},
			{
				...axiosConfig,
				timeout: 60000,
			},
		)

		// Inspect memory distribution in /api/ps
		const psResponse = await axios.get(`${normalizedBaseUrl}/api/ps`, axiosConfig).catch(() => null)
		let models: OllamaPsModel[] = psResponse?.data?.models || []
		let activeModel = findMatchingOllamaModel(models, modelName)

		// Brief retry if /api/ps hasn't updated immediately
		if (!activeModel && models.length === 0) {
			await new Promise((r) => setTimeout(r, 200))
			const retryPs = await axios.get(`${normalizedBaseUrl}/api/ps`, axiosConfig).catch(() => null)
			models = retryPs?.data?.models || []
			activeModel = findMatchingOllamaModel(models, modelName)
		}

		if (!activeModel) {
			return ProbeOllamaContextResponse.create({
				success: false,
				fitsOnGpu: false,
				gpuPercent: 0,
				cpuPercent: 100,
				error: "Model not found in running models list",
			})
		}

		const size = Number(activeModel.size || 0)
		const sizeVram = Number(activeModel.size_vram || 0)
		const fitsOnGpu = size > 0 && sizeVram > 0 && sizeVram >= size
		const gpuPercent = size > 0 ? (fitsOnGpu ? 100 : Math.min(99, Math.floor((sizeVram / size) * 100))) : 0
		const cpuPercent = 100 - gpuPercent

		return ProbeOllamaContextResponse.create({
			success: true,
			fitsOnGpu,
			gpuPercent,
			cpuPercent,
			sizeVram,
			size,
		})
	} catch (error: unknown) {
		const axiosErr = error as { response?: { data?: unknown }; message?: string }
		const errData = axiosErr?.response?.data
		const errMessage =
			typeof errData === "string" ? errData : (errData as { error?: string })?.error || axiosErr?.message || ""

		// If the error message indicates memory, VRAM, capacity exhaustion, or context limit,
		// the context size exceeded GPU limits rather than a fatal communication breakdown.
		if (isOllamaMemoryOrCapacityError(errMessage)) {
			return ProbeOllamaContextResponse.create({
				success: true,
				fitsOnGpu: false,
				gpuPercent: 0,
				cpuPercent: 100,
				error: "",
			})
		}

		return ProbeOllamaContextResponse.create({
			success: false,
			fitsOnGpu: false,
			gpuPercent: 0,
			cpuPercent: 100,
			error: errMessage || "Failed to probe Ollama context window",
		})
	}
}

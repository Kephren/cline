import { ProbeOllamaContextRequest, ProbeOllamaContextResponse } from "@shared/proto/cline/models"
import axios from "axios"
import { getAxiosSettings } from "@/shared/net"
import { Controller } from ".."

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
 * @param _controller The controller instance
 * @param request ProbeOllamaContextRequest containing baseUrl, modelName, and contextWindow
 * @returns ProbeOllamaContextResponse with fitsOnGpu, gpuPercent, sizeVram, size, and optional error
 */
export async function probeOllamaContext(
	_controller: Controller,
	request: ProbeOllamaContextRequest,
): Promise<ProbeOllamaContextResponse> {
	try {
		const baseUrl = request.baseUrl || "http://localhost:11434"
		const modelName = request.modelName
		const contextWindow = request.contextWindow

		if (!URL.canParse(baseUrl)) {
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
			`${baseUrl}/api/generate`,
			{
				model: modelName,
				prompt: "hi",
				stream: false,
				keep_alive: "5m",
				options: {
					num_ctx: Math.max(512, contextWindow),
					num_predict: 1,
				},
			},
			{
				...axiosConfig,
				timeout: 45000,
			},
		)

		// Inspect memory distribution in /api/ps
		const psResponse = await axios.get(`${baseUrl}/api/ps`, axiosConfig).catch(() => null)
		const models: OllamaPsModel[] = psResponse?.data?.models || []
		const normalize = (name?: string) =>
			(name || "")
				.trim()
				.toLowerCase()
				.replace(/:latest$/, "")
		const target = normalize(modelName)
		const activeModel =
			models.find((m: OllamaPsModel) => {
				const n = normalize(m.name)
				const mod = normalize(m.model)
				return n === target || mod === target || n.endsWith(`/${target}`) || mod.endsWith(`/${target}`)
			}) || models[0]

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
		const gpuPercent = size > 0 ? Math.round((sizeVram / size) * 100) : 100
		const cpuPercent = 100 - gpuPercent
		const fitsOnGpu = size > 0 ? sizeVram >= size : gpuPercent >= 100

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
		const isOom = /out of memory|cuda|vram|not enough space|allocation|too large/i.test(errMessage)

		if (isOom) {
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

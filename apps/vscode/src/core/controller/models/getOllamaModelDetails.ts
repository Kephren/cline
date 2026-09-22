import { OllamaModelDetailsRequest, OllamaModelDetailsResponse } from "@shared/proto/cline/models"
import axios from "axios"
import { getAxiosSettings } from "@/shared/net"
import { Controller } from ".."

/**
 * Fetches detailed model metadata from Ollama (/api/show)
 * @param _controller The controller instance
 * @param request The request containing base_url and model_name
 * @returns OllamaModelDetailsResponse with quantization, parameter size, native context length, and capabilities
 */
export async function getOllamaModelDetails(
	_controller: Controller,
	request: OllamaModelDetailsRequest,
): Promise<OllamaModelDetailsResponse> {
	try {
		const baseUrl = request.baseUrl || "http://localhost:11434"
		const modelName = request.modelName?.trim()

		if (!modelName || !URL.canParse(baseUrl)) {
			return OllamaModelDetailsResponse.create({})
		}

		const response = await axios.post(
			`${baseUrl}/api/show`,
			{
				model: modelName,
				verbose: true,
			},
			getAxiosSettings(),
		)

		const data = response.data || {}
		const details = data.details || {}
		const modelInfo = (data.model_info || {}) as Record<string, unknown>
		const parameters = typeof data.parameters === "string" ? data.parameters : ""
		const template = typeof data.template === "string" ? data.template : ""
		const modelfile = typeof data.modelfile === "string" ? data.modelfile : ""

		const format = details.format || ""
		const family = details.family || ""
		const families: string[] = Array.isArray(details.families) ? details.families : family ? [family] : []
		const parameterSize = details.parameter_size || ""
		const quantizationLevel = details.quantization_level || ""
		const parentModel = details.parent_model || ""

		// Extract native pre-trained context length from model_info (*.context_length)
		let contextLength: number | undefined
		for (const [key, val] of Object.entries(modelInfo)) {
			if (key.endsWith(".context_length") && typeof val === "number" && val > 0) {
				contextLength = val
				break
			}
		}

		// Fallback to parameters string (e.g. "num_ctx 32768")
		if (!contextLength && parameters) {
			const match = /num_ctx\s+(\d+)/i.exec(parameters)
			if (match) {
				const parsed = parseInt(match[1], 10)
				if (!Number.isNaN(parsed) && parsed > 0) {
					contextLength = parsed
				}
			}
		}

		// Check vision support
		const lowerFamilies = families.map((f) => f.toLowerCase())
		const hasVisionFamily = lowerFamilies.some((f) => f.includes("clip") || f.includes("mllama") || f.includes("vision"))
		const hasVisionKey = Object.keys(modelInfo).some((k) => k.toLowerCase().includes("vision"))
		const supportsVision = hasVisionFamily || hasVisionKey

		// Check tool calling support from template / modelfile
		const lowerTemplate = template.toLowerCase()
		const lowerModelfile = modelfile.toLowerCase()
		const supportsTools =
			lowerTemplate.includes(".tools") ||
			lowerTemplate.includes("tool_call") ||
			lowerTemplate.includes("<tools>") ||
			lowerModelfile.includes("tool_call")

		return OllamaModelDetailsResponse.create({
			format,
			family,
			families,
			parameterSize,
			quantizationLevel,
			contextLength,
			supportsTools,
			supportsVision,
			parentModel,
		})
	} catch (_error) {
		return OllamaModelDetailsResponse.create({})
	}
}

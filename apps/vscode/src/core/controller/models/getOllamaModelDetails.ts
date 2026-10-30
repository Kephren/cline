import { OllamaModelDetailsRequest, OllamaModelDetailsResponse } from "@shared/proto/cline/models"
import axios from "axios"
import { parseProviderId } from "@/sdk/model-catalog/provider-id"
import { Controller } from ".."
import { getOllamaAxiosSettings, normalizeOllamaModelName, normalizeOllamaUrl } from "./ollamaUtils"

/**
 * Fetches detailed model metadata from Ollama (/api/show, with fallback to /api/tags).
 * Does NOT request verbose GGUF tensor data so models without full GGUF tensor tables
 * or on parallel/remote servers can respond quickly without large overhead.
 *
 * @param controller The controller instance
 * @param request The request containing base_url and model_name
 * @returns OllamaModelDetailsResponse with quantization, parameter size, native context length, and capabilities
 */
export async function getOllamaModelDetails(
	controller: Controller,
	request: OllamaModelDetailsRequest,
): Promise<OllamaModelDetailsResponse> {
	try {
		let baseUrl = request.baseUrl?.trim()
		if (!baseUrl && controller && typeof controller.getProviderConfigStore === "function") {
			const store = controller.getProviderConfigStore()
			const config = store?.read(parseProviderId("ollama"))
			baseUrl = config?.baseUrl?.trim()
		}
		const normalizedBaseUrl = normalizeOllamaUrl(baseUrl)
		const modelName = request.modelName?.trim()

		if (!modelName || !normalizedBaseUrl) {
			return OllamaModelDetailsResponse.create({})
		}

		const axiosConfig = getOllamaAxiosSettings()

		let showData: Record<string, any> | undefined
		try {
			// Query /api/show without verbose: true to avoid dumping large GGUF tensor arrays
			const response = await axios.post(
				`${normalizedBaseUrl}/api/show`,
				{
					model: modelName,
				},
				axiosConfig,
			)
			showData = response.data || {}
		} catch (_showErr) {
			// /api/show may fail on some model formats or proxy servers; fallback to /api/tags below
		}

		const details = showData?.details || {}
		const modelInfo = (showData?.model_info || {}) as Record<string, unknown>
		const parameters = typeof showData?.parameters === "string" ? showData.parameters : ""
		const template = typeof showData?.template === "string" ? showData.template : ""
		const modelfile = typeof showData?.modelfile === "string" ? showData.modelfile : ""

		let format = details.format || ""
		let family = details.family || ""
		let families: string[] = Array.isArray(details.families) ? details.families : family ? [family] : []
		let parameterSize = details.parameter_size || ""
		let quantizationLevel = details.quantization_level || ""
		let parentModel = details.parent_model || ""
		let contextLength: number | undefined
		let hasToolsCapability = false
		let hasVisionCapability = false

		// 1. Direct details.context_length check (returned by Ollama for some models / runners)
		if (typeof details.context_length === "number" && details.context_length > 0) {
			contextLength = details.context_length
		} else if (typeof details.context_length === "string" && Number(details.context_length) > 0) {
			contextLength = Number(details.context_length)
		}

		// 2. Extract native pre-trained context length from model_info (*.context_length, etc.)
		if (!contextLength) {
			for (const [key, val] of Object.entries(modelInfo)) {
				const numVal = typeof val === "number" ? val : typeof val === "string" ? Number(val) : 0
				if (
					(key.endsWith(".context_length") ||
						key === "context_length" ||
						key.endsWith(".max_position_embeddings") ||
						key === "max_position_embeddings" ||
						key.endsWith(".context_window")) &&
					numVal > 0
				) {
					contextLength = numVal
					break
				}
			}
		}

		// 3. Fallback to parameters string (e.g. "num_ctx 32768" or "num_ctx: 32768")
		if (!contextLength && parameters) {
			const match = /num_ctx\s*[:= ]\s*(\d+)/i.exec(parameters)
			if (match) {
				const parsed = parseInt(match[1], 10)
				if (!Number.isNaN(parsed) && parsed > 0) {
					contextLength = parsed
				}
			}
		}

		// 4. Fallback to modelfile (e.g. "PARAMETER num_ctx 32768")
		if (!contextLength && modelfile) {
			const match = /PARAMETER\s+num_ctx\s*[:= ]\s*(\d+)/i.exec(modelfile) || /num_ctx\s*[:= ]\s*(\d+)/i.exec(modelfile)
			if (match) {
				const parsed = parseInt(match[1], 10)
				if (!Number.isNaN(parsed) && parsed > 0) {
					contextLength = parsed
				}
			}
		}

		// 5. Fallback to /api/tags if contextLength, details, or capabilities are missing or /api/show failed
		if (!contextLength || !format || families.length === 0) {
			try {
				const tagsResponse = await axios.get(`${normalizedBaseUrl}/api/tags`, axiosConfig)
				const models = tagsResponse.data?.models || []
				const target = normalizeOllamaModelName(modelName)
				const found = models.find((m: any) => {
					const n = normalizeOllamaModelName(m.name)
					const mod = normalizeOllamaModelName(m.model)
					return (
						n === target ||
						mod === target ||
						n.endsWith(`/${target}`) ||
						mod.endsWith(`/${target}`) ||
						target.endsWith(`/${n}`) ||
						target.endsWith(`/${mod}`)
					)
				})

				if (found) {
					const foundDetails = found.details || {}
					if (!contextLength && foundDetails.context_length) {
						contextLength = Number(foundDetails.context_length)
					}
					if (!format && foundDetails.format) format = foundDetails.format
					if (!family && foundDetails.family) family = foundDetails.family
					if (families.length === 0 && foundDetails.families) {
						families = Array.isArray(foundDetails.families)
							? foundDetails.families
							: [foundDetails.family].filter(Boolean)
					}
					if (!parameterSize && foundDetails.parameter_size) parameterSize = foundDetails.parameter_size
					if (!quantizationLevel && foundDetails.quantization_level) {
						quantizationLevel = foundDetails.quantization_level
					}
					if (!parentModel && foundDetails.parent_model) parentModel = foundDetails.parent_model

					if (Array.isArray(found.capabilities)) {
						if (found.capabilities.includes("tools")) hasToolsCapability = true
						if (found.capabilities.includes("vision")) hasVisionCapability = true
					}
				}
			} catch (_tagsErr) {
				// Non-fatal fallback
			}
		}

		// Check vision support
		const lowerFamilies = families.map((f) => f.toLowerCase())
		const hasVisionFamily = lowerFamilies.some((f) => f.includes("clip") || f.includes("mllama") || f.includes("vision"))
		const hasVisionKey = Object.keys(modelInfo).some((k) => k.toLowerCase().includes("vision"))
		const supportsVision = hasVisionFamily || hasVisionKey || hasVisionCapability

		// Check tool calling support from template / modelfile / capabilities
		const lowerTemplate = template.toLowerCase()
		const lowerModelfile = modelfile.toLowerCase()
		const supportsTools =
			hasToolsCapability ||
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

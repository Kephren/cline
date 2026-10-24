import { StringArray, StringRequest } from "@shared/proto/cline/common"
import axios from "axios"
import { parseProviderId } from "@/sdk/model-catalog/provider-id"
import { getAxiosSettings } from "@/shared/net"
import { Controller } from ".."
import { normalizeOllamaUrl } from "./ollamaUtils"

/**
 * Fetches available models from Ollama
 * @param controller The controller instance
 * @param request The request containing the base URL (optional)
 * @returns Array of model names
 */
export async function getOllamaModels(controller: Controller, request: StringRequest): Promise<StringArray> {
	try {
		let baseUrl: string | undefined = request.value?.trim()
		if (!baseUrl && controller && typeof controller.getProviderConfigStore === "function") {
			const store = controller.getProviderConfigStore()
			const config = store?.read(parseProviderId("ollama"))
			baseUrl = config?.baseUrl?.trim()
		}

		const normalizedBaseUrl = normalizeOllamaUrl(baseUrl)
		if (!normalizedBaseUrl) {
			return StringArray.create({ values: [] })
		}

		const response = await axios.get(`${normalizedBaseUrl}/api/tags`, getAxiosSettings())
		const modelsArray = response.data?.models?.map((model: any) => model.name) || []
		const models = [...new Set<string>(modelsArray)].sort()

		return StringArray.create({ values: models })
	} catch (_error) {
		return StringArray.create({ values: [] })
	}
}

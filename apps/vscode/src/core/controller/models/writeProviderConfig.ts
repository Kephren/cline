import { ProviderConfigResponse, WriteProviderConfigRequest } from "@/shared/proto/cline/models"
import {
	hasProviderCatalogStateController,
	type ProviderCatalogController,
	parseProviderIdRequest,
	toProviderConfigPatch,
	toRedactedProviderConfigResponse,
} from "./providerCatalogShared"

export async function writeProviderConfig(
	controller: ProviderCatalogController,
	request: WriteProviderConfigRequest,
): Promise<ProviderConfigResponse> {
	const providerId = parseProviderIdRequest(request.providerId)
	const store = controller.getProviderConfigStore()
	const previousApiConfiguration = hasProviderCatalogStateController(controller)
		? controller.stateManager.getApiConfiguration?.()
		: undefined
	const updated = store.write(providerId, toProviderConfigPatch(request.patch))

	if (hasProviderCatalogStateController(controller)) {
		if (providerId.toString() === "ollama") {
			const updates: Record<string, any> = {}
			if (request.patch?.baseUrl !== undefined) {
				updates.ollamaBaseUrl = request.patch.baseUrl?.trim() || undefined
			}
			if (request.patch?.contextWindow !== undefined) {
				const ctx = request.patch.contextWindow
				updates.ollamaApiOptionsCtxNum = ctx > 0 ? String(ctx) : undefined
			}
			if (request.patch?.reasoning?.enabled !== undefined) {
				updates.ollamaReasoning = request.patch.reasoning.enabled
			}
			if (Object.keys(updates).length > 0) {
				controller.stateManager.setGlobalStateBatch(updates)
				await controller.stateManager.flushPendingState?.()
				const nextApiConfiguration = controller.stateManager.getApiConfiguration?.()
				if (nextApiConfiguration) {
					controller.handleApiConfigurationChanged?.(previousApiConfiguration ?? {}, nextApiConfiguration)
				}
				await controller.postStateToWebview?.()
			}
		}
	}

	return toRedactedProviderConfigResponse(updated, store)
}

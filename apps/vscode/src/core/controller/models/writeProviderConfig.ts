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
		if (providerId.toString() === "ollama" && request.patch?.contextWindow !== undefined) {
			const ctx = request.patch.contextWindow
			controller.stateManager.setGlobalStateBatch({
				ollamaApiOptionsCtxNum: ctx > 0 ? String(ctx) : undefined,
			})
			await controller.stateManager.flushPendingState?.()
			const nextApiConfiguration = controller.stateManager.getApiConfiguration?.()
			if (nextApiConfiguration) {
				controller.handleApiConfigurationChanged?.(previousApiConfiguration ?? {}, nextApiConfiguration)
			}
			await controller.postStateToWebview?.()
		}
	}

	return toRedactedProviderConfigResponse(updated, store)
}

import type { ApiConfiguration } from "@shared/api"
import type { Mode } from "@shared/storage/types"
import type { StateManager } from "@/core/storage/StateManager"
import { toLegacyApiProvider } from "@/shared/model-catalog/provider-helpers"
import { Logger } from "@/shared/services/Logger"
import { parseProviderId } from "@/sdk/model-catalog/provider-id"
import { createProviderConfigStore } from "@/sdk/model-catalog/store"
import { resolveModelId } from "./cline-session-factory"
import type { SdkMessageCoordinator } from "./sdk-message-coordinator"
import type { SdkSessionConfigBuilder } from "./sdk-session-config-builder"
import type { SdkSessionLifecycle } from "./sdk-session-lifecycle"
import type { SdkSessionRebuildScheduler } from "./sdk-session-rebuild-scheduler"
import type { SdkSessionHost } from "./session-host"
import type { TaskProxy } from "./task-proxy"
import type { VscodeSessionHost } from "./vscode-session-host"

type StartInput = Parameters<VscodeSessionHost["start"]>[0]
type InitialMessages = StartInput["initialMessages"]
type SessionConfig = Awaited<ReturnType<SdkSessionConfigBuilder["build"]>>

export interface SdkProviderChangeCoordinatorOptions {
	stateManager: StateManager
	sessions: SdkSessionLifecycle
	messages: SdkMessageCoordinator
	sessionConfigBuilder: SdkSessionConfigBuilder
	getTask: () => TaskProxy | undefined
	getWorkspaceRoot: () => Promise<string>
	loadInitialMessages: (sdkHost: SdkSessionHost, sessionId: string) => Promise<InitialMessages>
	buildStartSessionInput: (config: SessionConfig, input: { cwd: string; mode: Mode }) => StartInput
	postStateToWebview: () => Promise<void>
	rebuilds: Pick<SdkSessionRebuildScheduler, "request">
}

function providerForMode(config: ApiConfiguration, mode: Mode): string | undefined {
	const provider = mode === "plan" ? config.planModeApiProvider : config.actModeApiProvider
	// Compare canonical spellings: previously-persisted snapshots can still
	// hold SDK ids like `openai-compatible` while new writes use the legacy
	// `openai` spelling; a spelling-only difference must not be treated as a
	// provider switch (it would restart the active session for nothing).
	return provider === undefined ? undefined : toLegacyApiProvider(provider)
}

function resolveActiveTemperature(providerId: string, mode: Mode, modelId: string | undefined): number | undefined {
	if (!modelId) return undefined
	try {
		const parsedProviderId = parseProviderId(providerId)
		const selection = createProviderConfigStore().readSelection(parsedProviderId, mode)
		return selection?.overrides?.temperature ?? selection?.modelInfo?.temperature
	} catch {
		return undefined
	}
}

export class SdkProviderChangeCoordinator {
	private lastActiveTemperature: number | undefined

	constructor(private readonly options: SdkProviderChangeCoordinatorOptions) {
		try {
			const mode = this.getCurrentMode()
			const config = this.options.stateManager.getApiConfiguration?.()
			if (config) {
				const provider = providerForMode(config, mode)
				const model = provider ? resolveModelId(provider, mode, config) : undefined
				this.lastActiveTemperature = provider ? resolveActiveTemperature(provider, mode, model) : undefined
			}
		} catch {
			// ignore initialization errors
		}
	}

	handleApiConfigurationChanged(previous: ApiConfiguration, next: ApiConfiguration): void {
		const mode = this.getCurrentMode()
		const previousProvider = providerForMode(previous, mode)
		const nextProvider = providerForMode(next, mode)

		const previousModel = previousProvider ? resolveModelId(previousProvider, mode, previous) : undefined
		const nextModel = nextProvider ? resolveModelId(nextProvider, mode, next) : undefined

		const providerChanged = previousProvider !== nextProvider
		const modelChanged = previousModel !== nextModel
		const contextChanged = previous.ollamaApiOptionsCtxNum !== next.ollamaApiOptionsCtxNum

		const currentTemperature = nextProvider ? resolveActiveTemperature(nextProvider, mode, nextModel) : undefined
		const temperatureChanged =
			this.lastActiveTemperature !== undefined && this.lastActiveTemperature !== currentTemperature
		this.lastActiveTemperature = currentTemperature

		if (!providerChanged && !modelChanged && !contextChanged && !temperatureChanged) {
			return
		}

		const activeSession = this.options.sessions.getActiveSession()
		if (!activeSession) {
			Logger.log(
				"[SdkController] Provider, model, context, or temperature changed without active session; next task will use new configuration",
			)
			return
		}

		const reason = providerChanged
			? `Active provider changed for ${mode}: ${previousProvider ?? "none"} -> ${nextProvider ?? "none"}`
			: modelChanged
				? `Active model changed for ${mode}: ${previousModel ?? "none"} -> ${nextModel ?? "none"}`
				: contextChanged
					? `Active context changed for ${mode}: ${previous.ollamaApiOptionsCtxNum ?? "default"} -> ${next.ollamaApiOptionsCtxNum ?? "default"}`
					: `Active temperature changed for ${mode}: ${currentTemperature ?? "default"}`

		Logger.log(`[SdkController] ${reason}`)

		this.options.rebuilds.request("provider", () => this.restartActiveSessionForProviderChange())
	}

	async restartActiveSessionForProviderChange(): Promise<void> {
		await this.performRestartActiveSessionForProviderChange()
	}

	private async performRestartActiveSessionForProviderChange(): Promise<void> {
		const activeSession = this.options.sessions.getActiveSession()
		if (!activeSession) {
			return
		}

		const { sdkHost: oldManager, sessionId: oldSessionId } = activeSession
		const cwd = await this.options.getWorkspaceRoot()
		const mode = this.getCurrentMode()

		Logger.log(`[SdkController] Restarting session ${oldSessionId} for provider change`)

		try {
			const config = await this.options.sessionConfigBuilder.build({ cwd, mode })
			config.sessionId = oldSessionId

			const initialMessages = await this.options.loadInitialMessages(oldManager, oldSessionId)
			const startInput = this.options.buildStartSessionInput(config, { cwd, mode })
			const restartResult = await this.options.sessions.replaceActiveSession({
				expectedSession: activeSession,
				startInput,
				...(initialMessages ? { initialMessages } : {}),
				disposeReason: "providerChange",
			})
			if (!restartResult) {
				return
			}

			const { startResult } = restartResult
			const task = this.options.getTask()
			if (task && task.taskId !== startResult.sessionId) {
				Logger.warn(
					`[SdkController] Provider restart returned a new session ID (${startResult.sessionId}); updating task proxy`,
				)
				task.taskId = startResult.sessionId
			}

			await this.options.postStateToWebview()
			Logger.log(`[SdkController] Session restarted for provider change: ${oldSessionId} -> ${startResult.sessionId}`)
		} catch (error) {
			Logger.error("[SdkController] Failed to restart session for provider change:", error)
			this.options.messages.appendAndEmit(
				[
					{
						ts: Date.now(),
						type: "say",
						say: "error",
						text: `Failed to reload provider configuration: ${
							error instanceof Error ? error.message : String(error)
						}. The active session may still use the previous provider.`,
						partial: false,
					},
				],
				{ type: "status", payload: { sessionId: oldSessionId, status: "error" } },
			)
			await this.options.postStateToWebview()
		}
	}

	private getCurrentMode(): Mode {
		return this.options.stateManager.getGlobalSettingsKey("mode") === "plan" ? "plan" : "act"
	}
}

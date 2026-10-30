import { fetch } from "@/shared/net"
import { Logger } from "@shared/services/Logger"
import * as vscode from "vscode"
import { type AutocompleteConfig, getEffectiveAutocompleteConfig, type StateProviderLike } from "./autocompleteConfig"

export class ClineInlineCompletionProvider implements vscode.InlineCompletionItemProvider {
	private provider: StateProviderLike
	private abortController: AbortController | null = null
	private isPreloading = false

	constructor(provider: StateProviderLike) {
		this.provider = provider
	}

	/**
	 * Preload the autocomplete model into Ollama VRAM with infinite keep_alive (-1).
	 * This prevents the model from cold-starting or unloading, respecting the server's infinite keep-alive.
	 */
	async preloadModel(config?: AutocompleteConfig): Promise<void> {
		if (this.isPreloading) {
			return
		}
		try {
			const effectiveConfig = config || (await getEffectiveAutocompleteConfig(this.provider))
			if (!effectiveConfig.enabled || !effectiveConfig.modelId || !effectiveConfig.baseUrl) {
				return
			}
			this.isPreloading = true
			Logger.log(
				`[ClineAutocomplete] Preloading model ${effectiveConfig.modelId} with infinite keep-alive (-1) and ${effectiveConfig.numCtx} context...`,
			)
			const headers: Record<string, string> = {
				"Content-Type": "application/json",
			}
			if (effectiveConfig.apiKey) {
				headers.Authorization = `Bearer ${effectiveConfig.apiKey}`
			}
			const payload = {
				model: effectiveConfig.modelId,
				prompt: "",
				stream: false,
				keep_alive: -1,
				options: {
					num_ctx: effectiveConfig.numCtx || 65536,
				},
			}
			const controller = new AbortController()
			const timeoutId = setTimeout(() => controller.abort(), 300000) // 5 min timeout for heavy initial load
			try {
				const response = await fetch(`${effectiveConfig.baseUrl}/api/generate`, {
					method: "POST",
					headers,
					body: JSON.stringify(payload),
					signal: controller.signal,
					duplex: "half",
				} as RequestInit)
				if (response.ok) {
					Logger.log(
						`[ClineAutocomplete] Successfully preloaded ${effectiveConfig.modelId} with infinite keep-alive (-1)`,
					)
				} else {
					Logger.warn(`[ClineAutocomplete] Preload returned status ${response.status}: ${response.statusText}`)
				}
			} finally {
				clearTimeout(timeoutId)
			}
		} catch (error: any) {
			Logger.warn(`[ClineAutocomplete] Failed to preload model: ${error?.message || error}`)
		} finally {
			this.isPreloading = false
		}
	}

	async preloadOnStartup(): Promise<void> {
		return this.preloadModel()
	}

	async provideInlineCompletionItems(
		document: vscode.TextDocument,
		position: vscode.Position,
		context: vscode.InlineCompletionContext,
		token: vscode.CancellationToken,
	): Promise<vscode.InlineCompletionList | vscode.InlineCompletionItem[] | undefined> {
		if (token.isCancellationRequested) {
			return undefined
		}

		const config = await getEffectiveAutocompleteConfig(this.provider)
		if (!config.enabled || !config.modelId) {
			return undefined
		}

		if (this.abortController) {
			this.abortController.abort()
			this.abortController = null
		}

		// Only debounce on automatic typing (not on manual trigger like Alt+\)
		const invokeKind = vscode.InlineCompletionTriggerKind?.Invoke ?? 1
		const isManual = context?.triggerKind === invokeKind
		if (!isManual) {
			await new Promise<void>((resolve) => {
				const timer = setTimeout(resolve, 100)
				token.onCancellationRequested(() => {
					clearTimeout(timer)
					resolve()
				})
			})
		}

		if (token.isCancellationRequested) {
			return undefined
		}

		const abortController = new AbortController()
		this.abortController = abortController

		const cancellationListener = token.onCancellationRequested(() => {
			abortController.abort()
		})

		let didTimeout = false
		const timeoutId = setTimeout(() => {
			didTimeout = true
			abortController.abort()
		}, config.requestTimeoutMs)

		const startTime = Date.now()
		Logger.log(
			`[ClineAutocomplete] Triggered (${isManual ? "manual" : "auto"}) using model ${config.modelId} at ${config.baseUrl}`,
		)

		try {
			const offset = document.offsetAt(position)
			const text = document.getText()

			const maxChars = Math.max(10000, Math.floor((config.numCtx || 65536) * 3))
			const prefixLimit = Math.floor(maxChars * 0.8)
			const suffixLimit = Math.floor(maxChars * 0.2)

			const prefixStart = Math.max(0, offset - prefixLimit)
			const prefix = text.slice(prefixStart, offset)

			const suffixEnd = Math.min(text.length, offset + suffixLimit)
			const suffix = text.slice(offset, suffixEnd)

			const fimPrompt = `<|fim_prefix|>${prefix}<|fim_suffix|>${suffix}<|fim_middle|>`

			const headers: Record<string, string> = {
				"Content-Type": "application/json",
			}
			if (config.apiKey) {
				headers.Authorization = `Bearer ${config.apiKey}`
			}

			const payload = {
				model: config.modelId,
				prompt: fimPrompt,
				raw: true,
				think: config.think ?? false,
				stream: false,
				keep_alive: -1,
				options: {
					num_ctx: config.numCtx || 65536,
					num_predict: 64,
					temperature: 0.2,
					stop: [
						"\n\n\n",
						"<|file_separator|>",
						"<|endoftext|>",
						"<|fim_prefix|>",
						"<|fim_suffix|>",
						"<|fim_middle|>",
						"<|im_end|>",
						"<|im_start|>",
					],
				},
			}

			const response = await fetch(`${config.baseUrl}/api/generate`, {
				method: "POST",
				headers,
				body: JSON.stringify(payload),
				signal: abortController.signal,
				duplex: "half",
			} as RequestInit)

			if (!response.ok) {
				Logger.warn(`[ClineAutocomplete] Ollama returned status ${response.status}: ${response.statusText}`)
				return undefined
			}

			const data = (await response.json()) as { response?: string }
			let completion = data.response || ""

			// Strip stray stop tokens, reasoning/think blocks, or prefixes if Ollama returns them
			completion = completion
				.replace(/<think>[\s\S]*?<\/think>/gi, "")
				.replace(/<\|fim_prefix\|>|<\|fim_suffix\|>|<\|fim_middle\|>|<\|im_end\|>|<\|im_start\|>/g, "")
				.trimEnd()

			// Avoid duplicating leading indentation on the current line
			const currentLineText = document.lineAt ? document.lineAt(position.line).text : ""
			const currentLinePrefix = currentLineText.slice(0, position.character)
			const lineIndentMatch = currentLinePrefix.match(/^\s+$/)
			if (lineIndentMatch) {
				const indent = lineIndentMatch[0]
				if (completion.startsWith(indent)) {
					completion = completion.slice(indent.length)
				}
			}

			if (!completion || completion.trim().length === 0) {
				Logger.log(`[ClineAutocomplete] Ollama returned empty completion in ${Date.now() - startTime}ms`)
				return undefined
			}

			const preview = completion.length > 50 ? `${completion.slice(0, 47)}...` : completion
			Logger.log(
				`[ClineAutocomplete] Success in ${Date.now() - startTime}ms (${completion.length} chars) using model ${config.modelId}: ${JSON.stringify(preview)}`,
			)

			const item = new vscode.InlineCompletionItem(completion, new vscode.Range(position, position))
			return new vscode.InlineCompletionList([item])
		} catch (error: any) {
			if (didTimeout) {
				Logger.warn(
					`[ClineAutocomplete] Request timed out after ${config.requestTimeoutMs}ms waiting for ${config.baseUrl}; retaining model with keep_alive: -1`,
				)
				// Ensure Ollama finishes warming and retains the model in memory with infinite keep_alive
				void this.preloadModel(config)
			} else if (error?.name === "AbortError") {
				Logger.debug(`[ClineAutocomplete] Request aborted due to new keystroke or cancellation`)
			} else {
				Logger.warn(`[ClineAutocomplete] Error fetching completion: ${error?.message || error}`)
			}
			return undefined
		} finally {
			clearTimeout(timeoutId)
			cancellationListener.dispose()
			if (this.abortController === abortController) {
				this.abortController = null
			}
		}
	}
}

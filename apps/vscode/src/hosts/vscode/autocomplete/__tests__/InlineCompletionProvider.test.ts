import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import * as vscode from "vscode"
import { ClineInlineCompletionProvider } from "../InlineCompletionProvider"

describe("ClineInlineCompletionProvider", () => {
	const originalFetch = global.fetch

	beforeEach(() => {
		vi.clearAllMocks()
	})

	afterEach(() => {
		global.fetch = originalFetch
	})

	it("returns undefined when autocomplete is disabled", async () => {
		const mockProvider = {
			stateManager: {
				getGlobalSettingsKey: (key: string) => (key === "autocompleteEnabled" ? false : undefined),
				getSecretKey: async () => undefined,
			},
		}

		const provider = new ClineInlineCompletionProvider(mockProvider as any)
		const mockDoc = {
			offsetAt: () => 10,
			getText: () => "const x = ",
			lineAt: () => ({ text: "const x = " }),
		} as unknown as vscode.TextDocument
		const mockPos = new vscode.Position(0, 10)
		const mockToken = {
			isCancellationRequested: false,
			onCancellationRequested: () => ({ dispose: () => {} }),
		} as unknown as vscode.CancellationToken

		const result = await provider.provideInlineCompletionItems(mockDoc, mockPos, {} as any, mockToken)
		expect(result).toBeUndefined()
	})

	it("returns undefined when no model is configured", async () => {
		const mockProvider = {
			stateManager: {
				getGlobalSettingsKey: (key: string) => {
					if (key === "autocompleteEnabled") return true
					if (key === "autocompleteShareWithChat") return false
					return undefined
				},
				getSecretKey: async () => undefined,
			},
		}

		const provider = new ClineInlineCompletionProvider(mockProvider as any)
		const mockDoc = {
			offsetAt: () => 10,
			getText: () => "const x = ",
			lineAt: () => ({ text: "const x = " }),
		} as unknown as vscode.TextDocument
		const mockPos = new vscode.Position(0, 10)
		const mockToken = {
			isCancellationRequested: false,
			onCancellationRequested: () => ({ dispose: () => {} }),
		} as unknown as vscode.CancellationToken

		const result = await provider.provideInlineCompletionItems(mockDoc, mockPos, {} as any, mockToken)
		expect(result).toBeUndefined()
	})

	it("calls Ollama /api/generate and returns inline completion item when enabled", async () => {
		const mockProvider = {
			stateManager: {
				getGlobalSettingsKey: (key: string) => {
					const map: Record<string, any> = {
						autocompleteEnabled: true,
						autocompleteShareWithChat: false,
						autocompleteBaseUrl: "http://localhost:11434",
						autocompleteModelId: "mannix/ornith-1.5-27b-a3b-coderx:Q3_K_M",
						autocompleteNumCtx: 8192,
						autocompleteRequestTimeoutMs: 5000,
					}
					return map[key]
				},
				getSecretKey: async () => undefined,
			},
		}

		let capturedUrl = ""
		let capturedBody: any = null

		global.fetch = vi.fn().mockImplementation(async (url: string, init: any) => {
			capturedUrl = url
			capturedBody = JSON.parse(init.body)
			return {
				ok: true,
				json: async () => ({
					response: "10;\nconsole.log(x);",
					done: true,
				}),
			} as Response
		}) as unknown as typeof fetch

		const provider = new ClineInlineCompletionProvider(mockProvider as any)
		const mockDoc = {
			offsetAt: () => 10,
			getText: () => "const x = ",
			lineAt: () => ({ text: "const x = " }),
		} as unknown as vscode.TextDocument
		const mockPos = new vscode.Position(0, 10)
		const mockToken = {
			isCancellationRequested: false,
			onCancellationRequested: () => ({ dispose: () => {} }),
		} as unknown as vscode.CancellationToken

		const result = (await provider.provideInlineCompletionItems(
			mockDoc,
			mockPos,
			{} as any,
			mockToken,
		)) as vscode.InlineCompletionList

		expect(capturedUrl).toBe("http://localhost:11434/api/generate")
		expect(capturedBody.model).toBe("mannix/ornith-1.5-27b-a3b-coderx:Q3_K_M")
		expect(capturedBody.raw).toBe(true)
		expect(capturedBody.think).toBe(false)
		expect(capturedBody.keep_alive).toBe(-1)
		expect(capturedBody.prompt).toContain("<|fim_prefix|>")
		expect(capturedBody.prompt).toContain("const x = ")
		expect(capturedBody.prompt).toContain("<|fim_middle|>")
		expect(capturedBody.options.num_ctx).toBe(8192)

		expect(result).toBeDefined()
		expect(result.items.length).toBe(1)
		expect(result.items[0].insertText).toBe("10;\nconsole.log(x);")
	})

	it("preloads the model on startup with infinite keep_alive (-1)", async () => {
		const mockProvider = {
			stateManager: {
				getGlobalSettingsKey: (key: string) => {
					const map: Record<string, any> = {
						autocompleteEnabled: true,
						autocompleteShareWithChat: false,
						autocompleteBaseUrl: "http://localhost:11434",
						autocompleteModelId: "mannix/ornith-1.5-27b-a3b-coderx:Q3_K_M",
						autocompleteNumCtx: 65536,
					}
					return map[key]
				},
				getSecretKey: async () => undefined,
			},
		}

		let preloadBody: any = null
		global.fetch = vi.fn().mockImplementation(async (_url: string, init: any) => {
			preloadBody = JSON.parse(init.body)
			return {
				ok: true,
				json: async () => ({}),
			} as Response
		}) as unknown as typeof fetch

		const provider = new ClineInlineCompletionProvider(mockProvider as any)
		await provider.preloadOnStartup()

		expect(preloadBody).toBeDefined()
		expect(preloadBody.model).toBe("mannix/ornith-1.5-27b-a3b-coderx:Q3_K_M")
		expect(preloadBody.keep_alive).toBe(-1)
		expect(preloadBody.prompt).toBe("")
		expect(preloadBody.options.num_ctx).toBe(65536)
	})

	it("preloads with infinite keep_alive (-1) when a completion request times out", async () => {
		const mockProvider = {
			stateManager: {
				getGlobalSettingsKey: (key: string) => {
					const map: Record<string, any> = {
						autocompleteEnabled: true,
						autocompleteShareWithChat: false,
						autocompleteBaseUrl: "http://localhost:11434",
						autocompleteModelId: "mannix/ornith-1.5-27b-a3b-coderx:Q3_K_M",
						autocompleteNumCtx: 65536,
						autocompleteRequestTimeoutMs: 10,
					}
					return map[key]
				},
				getSecretKey: async () => undefined,
			},
		}

		const fetchBodies: any[] = []
		global.fetch = vi.fn().mockImplementation(async (_url: string, init: any) => {
			const body = JSON.parse(init.body)
			fetchBodies.push(body)
			if (body.prompt !== "") {
				// Simulate hanging completion request that times out
				await new Promise((_, reject) => {
					init.signal?.addEventListener("abort", () => {
						const err = new Error("The operation was aborted")
						err.name = "AbortError"
						reject(err)
					})
				})
			}
			return {
				ok: true,
				json: async () => ({}),
			} as Response
		}) as unknown as typeof fetch

		const provider = new ClineInlineCompletionProvider(mockProvider as any)
		const mockDoc = {
			offsetAt: () => 10,
			getText: () => "const x = ",
			lineAt: () => ({ text: "const x = " }),
		} as unknown as vscode.TextDocument
		const mockPos = new vscode.Position(0, 10)
		const mockToken = {
			isCancellationRequested: false,
			onCancellationRequested: () => ({ dispose: () => {} }),
		} as unknown as vscode.CancellationToken

		const result = await provider.provideInlineCompletionItems(mockDoc, mockPos, {} as any, mockToken)
		expect(result).toBeUndefined()

		// Wait for the background preload to be invoked
		await new Promise((r) => setTimeout(r, 50))

		const preloadCall = fetchBodies.find((b) => b.prompt === "")
		expect(preloadCall).toBeDefined()
		expect(preloadCall.keep_alive).toBe(-1)
		expect(preloadCall.options.num_ctx).toBe(65536)
	})

	it("passes think: true and strips <think> tags from completion when enabled", async () => {
		const mockProvider = {
			stateManager: {
				getGlobalSettingsKey: (key: string) => {
					const map: Record<string, any> = {
						autocompleteEnabled: true,
						autocompleteShareWithChat: false,
						autocompleteBaseUrl: "http://localhost:11434",
						autocompleteModelId: "deepseek-r1:7b",
						autocompleteNumCtx: 65536,
						autocompleteRequestTimeoutMs: 5000,
						autocompleteThink: true,
					}
					return map[key]
				},
				getSecretKey: async () => undefined,
			},
		}

		let capturedBody: any = null
		global.fetch = vi.fn().mockImplementation(async (_url: string, init: any) => {
			capturedBody = JSON.parse(init.body)
			return {
				ok: true,
				json: async () => ({
					response: "<think>Let me reason about this assignment</think>20;",
					done: true,
				}),
			} as Response
		}) as unknown as typeof fetch

		const provider = new ClineInlineCompletionProvider(mockProvider as any)
		const mockDoc = {
			offsetAt: () => 10,
			getText: () => "const y = ",
			lineAt: () => ({ text: "const y = " }),
		} as unknown as vscode.TextDocument
		const mockPos = new vscode.Position(0, 10)
		const mockToken = {
			isCancellationRequested: false,
			onCancellationRequested: () => ({ dispose: () => {} }),
		} as unknown as vscode.CancellationToken

		const result = (await provider.provideInlineCompletionItems(
			mockDoc,
			mockPos,
			{} as any,
			mockToken,
		)) as vscode.InlineCompletionList

		expect(capturedBody.think).toBe(true)
		expect(result).toBeDefined()
		expect(result.items[0].insertText).toBe("20;")
	})
})

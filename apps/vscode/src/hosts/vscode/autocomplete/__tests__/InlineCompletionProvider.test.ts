import axios from "axios"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import * as vscode from "vscode"
import { ClineInlineCompletionProvider } from "../InlineCompletionProvider"

describe("ClineInlineCompletionProvider", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.restoreAllMocks()
	})

	afterEach(() => {
		vi.restoreAllMocks()
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
		let capturedConfig: any = null

		vi.spyOn(axios, "post").mockImplementation(async (url: string, body: any, config: any) => {
			capturedUrl = url
			capturedBody = body
			capturedConfig = config
			return {
				status: 200,
				statusText: "OK",
				data: {
					response: "10;\nconsole.log(x);",
					done: true,
				},
			} as any
		})

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
		expect(capturedConfig.adapter).toBe("http")
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
		let preloadConfig: any = null
		vi.spyOn(axios, "post").mockImplementation(async (_url: string, body: any, config: any) => {
			preloadConfig = config
			preloadBody = body
			return {
				status: 200,
				statusText: "OK",
				data: {},
			} as any
		})

		const provider = new ClineInlineCompletionProvider(mockProvider as any)
		await provider.preloadOnStartup()

		expect(preloadBody).toBeDefined()
		expect(preloadConfig.adapter).toBe("http")
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

		const postBodies: any[] = []
		vi.spyOn(axios, "post").mockImplementation(async (_url: string, body: any, config: any) => {
			postBodies.push(body)
			if (body.prompt !== "") {
				// Simulate hanging completion request that times out
				await new Promise((_, reject) => {
					config.signal?.addEventListener("abort", () => {
						const err = new Error("timeout")
						;(err as any).code = "ECONNABORTED"
						reject(err)
					})
				})
			}
			return {
				status: 200,
				statusText: "OK",
				data: {},
			} as any
		})

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

		const preloadCall = postBodies.find((b) => b.prompt === "")
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
		vi.spyOn(axios, "post").mockImplementation(async (_url: string, body: any) => {
			capturedBody = body
			return {
				status: 200,
				statusText: "OK",
				data: {
					response: "<think>Let me reason about this assignment</think>20;",
					done: true,
				},
			} as any
		})

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

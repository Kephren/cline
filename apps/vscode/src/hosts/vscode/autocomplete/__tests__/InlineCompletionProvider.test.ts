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
		expect(capturedBody.prompt).toContain("<|fim_prefix|>")
		expect(capturedBody.prompt).toContain("const x = ")
		expect(capturedBody.prompt).toContain("<|fim_middle|>")
		expect(capturedBody.options.num_ctx).toBe(8192)

		expect(result).toBeDefined()
		expect(result.items.length).toBe(1)
		expect(result.items[0].insertText).toBe("10;\nconsole.log(x);")
	})
})

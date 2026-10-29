import { describe, expect, it } from "vitest"
import { getEffectiveAutocompleteConfig } from "../autocompleteConfig"

describe("getEffectiveAutocompleteConfig", () => {
	it("returns standalone settings when autocompleteShareWithChat is false", async () => {
		const mockStateManager = {
			getGlobalSettingsKey: (key: string) => {
				const settings: Record<string, any> = {
					autocompleteEnabled: true,
					autocompleteShareWithChat: false,
					autocompleteBaseUrl: "http://127.0.0.1:11434/",
					autocompleteModelId: "qwen2.5-coder:7b",
					autocompleteNumCtx: 8192,
					autocompleteRequestTimeoutMs: 3000,
				}
				return settings[key]
			},
			getSecretKey: async (key: string) => (key === "autocompleteApiKey" ? "test-key" : undefined),
		}

		const config = await getEffectiveAutocompleteConfig({ stateManager: mockStateManager })

		expect(config.enabled).toBe(true)
		expect(config.baseUrl).toBe("http://127.0.0.1:11434")
		expect(config.apiKey).toBe("test-key")
		expect(config.modelId).toBe("qwen2.5-coder:7b")
		expect(config.numCtx).toBe(8192)
		expect(config.requestTimeoutMs).toBe(3000)
		expect(config.think).toBe(false)
	})

	it("returns shared chat Ollama settings when autocompleteShareWithChat is true", async () => {
		const mockStateManager = {
			getGlobalSettingsKey: (key: string) => {
				const settings: Record<string, any> = {
					autocompleteEnabled: true,
					autocompleteShareWithChat: true,
					ollamaBaseUrl: "http://localhost:11434",
					ollamaModelId: "mannix/ornith-1.5-27b-a3b-coderx:Q3_K_M",
					ollamaApiOptionsCtxNum: "16384",
					requestTimeoutMs: 7000,
				}
				return settings[key]
			},
			getSecretKey: async (key: string) => (key === "ollamaApiKey" ? "chat-key" : undefined),
			getApiConfiguration: () => ({
				ollamaBaseUrl: "http://localhost:11434",
				ollamaModelId: "mannix/ornith-1.5-27b-a3b-coderx:Q3_K_M",
				ollamaApiOptionsCtxNum: "16384",
				requestTimeoutMs: 7000,
			}),
		}

		const config = await getEffectiveAutocompleteConfig({ stateManager: mockStateManager })

		expect(config.enabled).toBe(true)
		expect(config.baseUrl).toBe("http://localhost:11434")
		expect(config.modelId).toBe("mannix/ornith-1.5-27b-a3b-coderx:Q3_K_M")
		expect(config.numCtx).toBe(16384)
		expect(config.requestTimeoutMs).toBe(7000)
		expect(config.think).toBe(false)
	})

	it("falls back to default values when configuration is empty", async () => {
		const mockStateManager = {
			getGlobalSettingsKey: () => undefined,
			getSecretKey: async () => undefined,
		}

		const config = await getEffectiveAutocompleteConfig({ stateManager: mockStateManager })

		expect(config.enabled).toBe(true)
		expect(config.baseUrl).toBe("http://localhost:11434")
		expect(config.modelId).toBeUndefined()
		expect(config.numCtx).toBe(65536)
		expect(config.requestTimeoutMs).toBe(20000)
		expect(config.think).toBe(false)
	})

	it("respects autocompleteThink when enabled", async () => {
		const mockStateManager = {
			getGlobalSettingsKey: (key: string) => {
				const settings: Record<string, any> = {
					autocompleteEnabled: true,
					autocompleteShareWithChat: false,
					autocompleteThink: true,
				}
				return settings[key]
			},
			getSecretKey: async () => undefined,
		}

		const config = await getEffectiveAutocompleteConfig({ stateManager: mockStateManager })
		expect(config.think).toBe(true)
	})
})

import type { ApiProvider } from "@shared/api"
import { describe, expect, it } from "vitest"
import { convertApiConfigurationToProto, convertProtoToApiConfiguration } from "./api-configuration-conversion"

describe("api configuration provider conversion", () => {
	it("round-trips SDK provider ids added after the legacy enum list", () => {
		const providers: ApiProvider[] = ["poolside", "v0", "xiaomi", "tencent-tokenhub", "chutes", "zai-coding-plan"]

		for (const provider of providers) {
			const proto = convertApiConfigurationToProto({
				actModeApiProvider: provider,
				planModeApiProvider: provider,
			})

			// Assert field-by-field instead of toMatchObject: this file is also picked up by
			// the mocha integration runner (.vscode-test.mjs globs src/shared/**/*.test.js),
			// where vitest's jest-compat matchers like toMatchObject are not available.
			const result = convertProtoToApiConfiguration(proto)
			expect(result.actModeApiProvider).toBe(provider)
			expect(result.planModeApiProvider).toBe(provider)
		}
	})

	it("round-trips Ollama sampling, reasoning, and tuned settings", () => {
		const config = {
			ollamaTemperature: 0.7,
			ollamaMinP: 0.15,
			ollamaSeedEnabled: true,
			ollamaSeedValue: 12345,
			ollamaReasoning: false,
			ollamaIsTuned: true,
			ollamaTunedContextSize: 16384,
			ollamaTunedModel: "qwen2.5:latest",
			ollamaTopP: 0.92,
			ollamaTopK: 45,
			ollamaRepeatPenalty: 1.15,
		}

		const proto = convertApiConfigurationToProto(config)
		const result = convertProtoToApiConfiguration(proto)

		expect(result.ollamaTemperature).toBe(0.7)
		expect(result.ollamaMinP).toBe(0.15)
		expect(result.ollamaSeedEnabled).toBe(true)
		expect(result.ollamaSeedValue).toBe(12345)
		expect(result.ollamaReasoning).toBe(false)
		expect(result.ollamaIsTuned).toBe(true)
		expect(result.ollamaTunedContextSize).toBe(16384)
		expect(result.ollamaTunedModel).toBe("qwen2.5:latest")
		expect(result.ollamaTopP).toBe(0.92)
		expect(result.ollamaTopK).toBe(45)
		expect(result.ollamaRepeatPenalty).toBe(1.15)
	})
})

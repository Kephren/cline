import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { OllamaModelDetailsRequest } from "@shared/proto/cline/models"
import axios from "axios"
import sinon from "sinon"
import type { Controller } from "../../index"
import { getOllamaModelDetails } from "../getOllamaModelDetails"

describe("getOllamaModelDetails", () => {
	let sandbox: sinon.SinonSandbox
	let axiosGet: sinon.SinonStub
	let axiosPost: sinon.SinonStub

	beforeEach(() => {
		sandbox = sinon.createSandbox()
		axiosGet = sandbox.stub(axios, "get")
		axiosPost = sandbox.stub(axios, "post")
	})

	afterEach(() => {
		sandbox.restore()
	})

	const mockController = {} as Controller

	it("queries /api/show without verbose: true and extracts context_length from model_info", async () => {
		axiosPost.resolves({
			data: {
				details: {
					format: "gguf",
					family: "qwen35",
					families: ["qwen35"],
					parameter_size: "27.3B",
					quantization_level: "PTQ1_0",
				},
				model_info: {
					"qwen35.context_length": 262144,
				},
				template: "{{ if .Tools }}tools{{ end }}",
			},
		})

		const request = OllamaModelDetailsRequest.create({
			baseUrl: "http://192.168.80.170:22434",
			modelName: "mannix/Bonsai-2-27B:latest",
		})

		const response = await getOllamaModelDetails(mockController, request)

		expect(axiosPost.calledOnce).toBe(true)
		expect(axiosPost.firstCall.args[0]).toBe("http://192.168.80.170:22434/api/show")
		// Verify verbose is NOT true (no GGUF tensor dump requested)
		expect(axiosPost.firstCall.args[1]).toEqual({
			model: "mannix/Bonsai-2-27B:latest",
		})

		expect(response.contextLength).toBe(262144)
		expect(response.family).toBe("qwen35")
		expect(response.parameterSize).toBe("27.3B")
		expect(response.quantizationLevel).toBe("PTQ1_0")
		expect(response.supportsTools).toBe(true)
	})

	it("normalizes malformed base URL (e.g. http:192.168.80.170:22434 or trailing slash)", async () => {
		axiosPost.resolves({
			data: {
				details: { context_length: 32768, family: "llama" },
			},
		})

		const request = OllamaModelDetailsRequest.create({
			baseUrl: "http:192.168.80.170:22434/",
			modelName: "test-model",
		})

		const response = await getOllamaModelDetails(mockController, request)

		expect(axiosPost.firstCall.args[0]).toBe("http://192.168.80.170:22434/api/show")
		expect(response.contextLength).toBe(32768)
	})

	it("falls back to /api/tags when /api/show fails or lacks context_length", async () => {
		// /api/show rejects (e.g. model doesn't support show, or 500 error)
		axiosPost.rejects(new Error("Internal Server Error"))
		axiosGet.resolves({
			data: {
				models: [
					{
						name: "mannix/Bonsai-2-27B:latest",
						model: "mannix/Bonsai-2-27B:latest",
						details: {
							format: "gguf",
							family: "qwen35",
							parameter_size: "27.3B",
							quantization_level: "PTQ1_0",
							context_length: 262144,
						},
						capabilities: ["tools", "vision"],
					},
				],
			},
		})

		const request = OllamaModelDetailsRequest.create({
			baseUrl: "http://192.168.80.170:22434",
			modelName: "mannix/Bonsai-2-27B:latest",
		})

		const response = await getOllamaModelDetails(mockController, request)

		expect(axiosGet.calledOnce).toBe(true)
		expect(axiosGet.firstCall.args[0]).toBe("http://192.168.80.170:22434/api/tags")
		expect(response.contextLength).toBe(262144)
		expect(response.family).toBe("qwen35")
		expect(response.supportsTools).toBe(true)
		expect(response.supportsVision).toBe(true)
	})

	it("extracts context_length from parameters when model_info lacks it", async () => {
		axiosPost.resolves({
			data: {
				details: { family: "mistral" },
				parameters: "stop <|im_end|>\nnum_ctx 32768\ntemperature 0.7",
			},
		})

		const request = OllamaModelDetailsRequest.create({
			baseUrl: "http://localhost:11434",
			modelName: "mistral:latest",
		})

		const response = await getOllamaModelDetails(mockController, request)
		expect(response.contextLength).toBe(32768)
	})

	it("extracts context_length from modelfile when parameters lacks it", async () => {
		axiosPost.resolves({
			data: {
				details: { family: "mistral" },
				modelfile: "FROM mistral\nPARAMETER num_ctx 65536\nSYSTEM You are an assistant",
			},
		})

		const request = OllamaModelDetailsRequest.create({
			baseUrl: "http://localhost:11434",
			modelName: "mistral:latest",
		})

		const response = await getOllamaModelDetails(mockController, request)
		expect(response.contextLength).toBe(65536)
	})

	it("returns empty response on invalid URL or missing modelName", async () => {
		const res1 = await getOllamaModelDetails(
			mockController,
			OllamaModelDetailsRequest.create({
				baseUrl: "not_a_valid_url",
				modelName: "model",
			}),
		)
		expect(res1.contextLength).toBeUndefined()

		const res2 = await getOllamaModelDetails(
			mockController,
			OllamaModelDetailsRequest.create({
				baseUrl: "http://localhost:11434",
				modelName: "",
			}),
		)
		expect(res2.contextLength).toBeUndefined()
	})
})

import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { ProbeOllamaContextRequest } from "@shared/proto/cline/models"
import axios from "axios"
import sinon from "sinon"
import type { Controller } from "../../index"
import { probeOllamaContext } from "../probeOllamaContext"

describe("probeOllamaContext", () => {
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

	it("reports fitsOnGpu true when model is 100% offloaded to VRAM", async () => {
		axiosPost.resolves({ data: {} })
		axiosGet.resolves({
			data: {
				models: [
					{
						name: "llama3:8b",
						size: 4991221760,
						size_vram: 4991221760,
					},
				],
			},
		})

		const request = ProbeOllamaContextRequest.create({
			baseUrl: "http://localhost:11434",
			modelName: "llama3:8b",
			contextWindow: 16384,
		})

		const response = await probeOllamaContext(mockController, request)

		expect(response.success).toBe(true)
		expect(response.fitsOnGpu).toBe(true)
		expect(response.gpuPercent).toBe(100)
		expect(response.cpuPercent).toBe(0)
		expect(Number(response.sizeVram)).toBe(4991221760)

		// Verify axios calls
		expect(axiosPost.calledOnce).toBe(true)
		expect(axiosPost.firstCall.args[0]).toBe("http://localhost:11434/api/generate")
		expect(axiosPost.firstCall.args[1]).toEqual({
			model: "llama3:8b",
			prompt: "hi",
			stream: false,
			keep_alive: "5m",
			options: {
				num_ctx: 16384,
				num_predict: 1,
			},
		})

		expect(axiosGet.calledOnce).toBe(true)
		expect(axiosGet.firstCall.args[0]).toBe("http://localhost:11434/api/ps")
	})

	it("reports fitsOnGpu false when context window causes spillover to CPU RAM", async () => {
		axiosPost.resolves({ data: {} })
		axiosGet.resolves({
			data: {
				models: [
					{
						name: "llama3:8b",
						size: 6000000000,
						size_vram: 4800000000,
					},
				],
			},
		})

		const request = ProbeOllamaContextRequest.create({
			baseUrl: "http://localhost:11434",
			modelName: "llama3:8b",
			contextWindow: 65536,
		})

		const response = await probeOllamaContext(mockController, request)

		expect(response.success).toBe(true)
		expect(response.fitsOnGpu).toBe(false)
		expect(response.gpuPercent).toBe(80)
		expect(response.cpuPercent).toBe(20)
	})

	it("handles Ollama OOM error as fitsOnGpu false", async () => {
		axiosPost.rejects(new Error("CUDA out of memory"))

		const request = ProbeOllamaContextRequest.create({
			baseUrl: "http://localhost:11434",
			modelName: "llama3:8b",
			contextWindow: 131072,
		})

		const response = await probeOllamaContext(mockController, request)

		expect(response.success).toBe(true)
		expect(response.fitsOnGpu).toBe(false)
		expect(response.gpuPercent).toBe(0)
	})

	it("reports success false on network connection failure", async () => {
		axiosPost.rejects(new Error("connect ECONNREFUSED 127.0.0.1:11434"))

		const request = ProbeOllamaContextRequest.create({
			baseUrl: "http://localhost:11434",
			modelName: "llama3:8b",
			contextWindow: 8192,
		})

		const response = await probeOllamaContext(mockController, request)

		expect(response.success).toBe(false)
		expect(response.fitsOnGpu).toBe(false)
		expect(response.error).toContain("ECONNREFUSED")
	})

	it("validates missing model name or invalid baseUrl", async () => {
		const invalidUrlReq = ProbeOllamaContextRequest.create({
			baseUrl: "not_a_valid_url",
			modelName: "llama3:8b",
			contextWindow: 8192,
		})
		const res1 = await probeOllamaContext(mockController, invalidUrlReq)
		expect(res1.success).toBe(false)
		expect(res1.error).toBe("Invalid base URL")

		const missingModelReq = ProbeOllamaContextRequest.create({
			baseUrl: "http://localhost:11434",
			modelName: "",
			contextWindow: 8192,
		})
		const res2 = await probeOllamaContext(mockController, missingModelReq)
		expect(res2.success).toBe(false)
		expect(res2.error).toBe("Model name is required")
	})
})

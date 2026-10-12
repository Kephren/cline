import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { ReloadOllamaModelRequest } from "@shared/proto/cline/models"
import axios from "axios"
import sinon from "sinon"
import type { Controller } from "../../index"
import { reloadOllamaModel } from "../reloadOllamaModel"

describe("reloadOllamaModel", () => {
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

	it("unloads running models and preloads the target model with num_ctx", async () => {
		axiosGet.resolves({
			data: {
				models: [{ name: "llama3.1:latest" }],
			},
		})
		axiosPost.resolves({ data: {} })

		const request = ReloadOllamaModelRequest.create({
			baseUrl: "http://localhost:11434",
			modelName: "qwen2.5-coder:7b",
			contextWindow: 16384,
		})

		await reloadOllamaModel(mockController, request)

		// Should call GET /api/ps
		expect(axiosGet.calledOnce).toBe(true)
		expect(axiosGet.firstCall.args[0]).toBe("http://localhost:11434/api/ps")

		// Should call POST /api/generate to unload llama3.1:latest and qwen2.5-coder:7b
		// then POST /api/generate to preload qwen2.5-coder:7b with options.num_ctx = 16384
		expect(axiosPost.callCount).toBe(3)

		// First unload: running model
		expect(axiosPost.getCall(0).args[0]).toBe("http://localhost:11434/api/generate")
		expect(axiosPost.getCall(0).args[1]).toEqual({ model: "llama3.1:latest", keep_alive: 0 })

		// Second unload: target model
		expect(axiosPost.getCall(1).args[0]).toBe("http://localhost:11434/api/generate")
		expect(axiosPost.getCall(1).args[1]).toEqual({ model: "qwen2.5-coder:7b", keep_alive: 0 })

		// Third call: preload with num_ctx
		expect(axiosPost.getCall(2).args[0]).toBe("http://localhost:11434/api/generate")
		expect(axiosPost.getCall(2).args[1]).toEqual({
			model: "qwen2.5-coder:7b",
			prompt: "",
			stream: false,
			options: { num_ctx: 16384, num_batch: 512 },
		})
	})

	it("handles unreachable Ollama instances gracefully without throwing", async () => {
		axiosGet.rejects(new Error("ECONNREFUSED"))
		axiosPost.rejects(new Error("ECONNREFUSED"))

		const request = ReloadOllamaModelRequest.create({
			baseUrl: "http://localhost:11434",
			modelName: "llama3.1:latest",
			contextWindow: 8192,
		})

		const result = await reloadOllamaModel(mockController, request)
		expect(result).toBeDefined()
	})
})

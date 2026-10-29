import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { updateSetting } from "../utils/settingsHandlers"
import { AutocompleteSection } from "./AutocompleteSection"

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: vi.fn(),
}))

vi.mock("@/hooks/useProviderConfig", () => ({
	useProviderConfig: vi.fn().mockReturnValue({
		config: {
			baseUrl: "http://127.0.0.1:11434",
			actSelection: {
				modelId: "mannix/ornith-1.5-27b-a3b-coderx:Q3_K_M",
			},
			contextWindow: 8192,
		},
	}),
}))

vi.mock("@/services/grpc-client", () => ({
	ModelsServiceClient: {
		getOllamaModels: vi.fn().mockResolvedValue({ values: ["qwen2.5-coder:7b", "starcoder2:7b"] }),
		getOllamaModelStatus: vi.fn().mockResolvedValue({
			isRunning: true,
			modelName: "byczech/qwen3.6-mmproj-16G-UD-IQ3_S:35b",
			size: 14000000000,
			sizeVram: 14000000000,
			gpuPercent: 100,
			cpuPercent: 0,
		}),
		reloadOllamaModel: vi.fn().mockResolvedValue({}),
		unloadOllamaModel: vi.fn().mockResolvedValue({}),
	},
}))

vi.mock("../utils/settingsHandlers", () => ({
	updateSetting: vi.fn(),
}))

describe("AutocompleteSection", () => {
	const defaultState = {
		autocompleteEnabled: true,
		autocompleteShareWithChat: true,
		autocompleteBaseUrl: "http://localhost:11434",
		autocompleteApiKey: undefined,
		autocompleteModelId: "qwen2.5-coder:7b",
		autocompleteNumCtx: 4096,
		autocompleteRequestTimeoutMs: 5000,
		apiConfiguration: {
			ollamaBaseUrl: "http://127.0.0.1:11434",
			actModeOllamaModelId: "mannix/ornith-1.5-27b-a3b-coderx:Q3_K_M",
			ollamaApiOptionsCtxNum: "8192",
			requestTimeoutMs: 5000,
		},
	}

	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(useExtensionState).mockReturnValue(defaultState as any)
	})

	it("renders Enable Inline Autocomplete toggle and toggles it", () => {
		render(<AutocompleteSection renderSectionHeader={() => <div>Header</div>} />)
		const checkbox = screen.getByText("Enable Inline Autocomplete")
		expect(checkbox).toBeDefined()
		fireEvent.click(checkbox)
		expect(updateSetting).toHaveBeenCalledWith("autocompleteEnabled", false)
	})

	it("renders Share settings with Chat model toggle and updates setting", () => {
		render(<AutocompleteSection renderSectionHeader={() => <div>Header</div>} />)
		const shareCheckbox = screen.getByText("Share settings with Chat model")
		expect(shareCheckbox).toBeDefined()
		fireEvent.click(shareCheckbox)
		expect(updateSetting).toHaveBeenCalledWith("autocompleteShareWithChat", false)
	})

	it("copies chat Ollama settings when Copy from Chat is clicked", () => {
		render(<AutocompleteSection renderSectionHeader={() => <div>Header</div>} />)
		const copyButton = screen.getByText("Copy settings from Chat")
		expect(copyButton).toBeDefined()
		fireEvent.click(copyButton)
		expect(updateSetting).toHaveBeenCalledWith("autocompleteShareWithChat", false)
		expect(updateSetting).toHaveBeenCalledWith("autocompleteBaseUrl", "http://127.0.0.1:11434")
		expect(updateSetting).toHaveBeenCalledWith("autocompleteModelId", "mannix/ornith-1.5-27b-a3b-coderx:Q3_K_M")
		expect(updateSetting).toHaveBeenCalledWith("autocompleteNumCtx", 8192)
		expect(updateSetting).toHaveBeenCalledWith("autocompleteRequestTimeoutMs", 5000)
	})

	it("displays active chat settings when sharing is enabled", () => {
		render(<AutocompleteSection renderSectionHeader={() => <div>Header</div>} />)
		expect(screen.getByText("Active Shared Chat Configuration")).toBeDefined()
		expect(screen.getByText("mannix/ornith-1.5-27b-a3b-coderx:Q3_K_M")).toBeDefined()
	})

	it("renders standalone model picker and calls refresh models", async () => {
		vi.mocked(useExtensionState).mockReturnValue({
			...defaultState,
			autocompleteShareWithChat: false,
		} as any)
		render(<AutocompleteSection renderSectionHeader={() => <div>Header</div>} />)
		expect(screen.getByText("Standalone Autocomplete Configuration")).toBeDefined()
		const refreshButton = await screen.findByText("Refresh models")
		expect(refreshButton).toBeDefined()
		fireEvent.click(refreshButton)
	})

	it("handles preloading and unloading model with Chat-like controls", async () => {
		render(<AutocompleteSection renderSectionHeader={() => <div>Header</div>} />)
		const preloadButton = await screen.findByTestId("ollama-preload-button")
		expect(preloadButton).toBeDefined()
		fireEvent.click(preloadButton)

		const unloadButton = await screen.findByTestId("unload-ollama-model-button")
		expect(unloadButton).toBeDefined()
		fireEvent.click(unloadButton)

		const gpuRatio = await screen.findByTestId("gpu-cpu-ratio")
		expect(gpuRatio).toBeDefined()
	})
})


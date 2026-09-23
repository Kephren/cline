import { act, fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import ChatTextArea from "./ChatTextArea"

const mocks = vi.hoisted(() => ({
	supportsImages: true as boolean | undefined,
	selectedProvider: "anthropic",
	selectedModelId: "text-only-model",
	selectedModelInfo: undefined as Record<string, unknown> | undefined,
	ollamaModelDetails: undefined as Record<string, unknown> | undefined,
	commitModelSelection: vi.fn(async () => ({})),
	writeProviderConfig: vi.fn(async () => ({})),
	probeOllamaContext: vi.fn(async () => ({ success: true, fitsOnGpu: true, gpuPercent: 100 })),
	updateApiConfigurationProto: vi.fn(async () => ({})),
	apiConfiguration: {} as Record<string, unknown>,
	providerConfig: undefined as Record<string, unknown> | undefined,
	navigateToSettingsModelPicker: vi.fn(),
	clineMessages: [] as any[],
}))

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({
		mode: "act",
		apiConfiguration: mocks.apiConfiguration,
		openRouterModels: {},
		platform: "darwin",
		localWorkflowToggles: {},
		globalWorkflowToggles: {},
		remoteWorkflowToggles: {},
		remoteConfigSettings: undefined,
		navigateToSettingsModelPicker: mocks.navigateToSettingsModelPicker,
		mcpServers: [],
		clineMessages: mocks.clineMessages,
	}),
}))

vi.mock("@/context/PlatformContext", () => ({
	usePlatform: () => ({ togglePlanActKeys: "Meta+Shift+a" }),
}))

vi.mock("@/hooks/useNormalizedApiConfiguration", () => ({
	useNormalizedApiConfiguration: () => ({
		selectedProvider: mocks.selectedProvider,
		selectedModelId: mocks.selectedModelId,
		selectedModelInfo: mocks.selectedModelInfo ?? { supportsImages: mocks.supportsImages },
	}),
}))

vi.mock("@/services/grpc-client", () => ({
	FileServiceClient: {
		searchCommits: vi.fn(async () => ({ commits: [] })),
		searchFiles: vi.fn(async () => ({ results: [] })),
		getRelativePaths: vi.fn(async () => ({ paths: [] })),
		openImage: vi.fn(async () => ({})),
		openFile: vi.fn(async () => ({})),
	},
	StateServiceClient: {
		togglePlanActModeProto: vi.fn(async () => ({})),
	},
	ModelsServiceClient: {
		getOllamaModelStatus: vi.fn(async () => ({})),
		getOllamaModels: vi.fn(async () => ({ values: [] })),
		getOllamaModelDetails: vi.fn(async () => mocks.ollamaModelDetails ?? {}),
		commitModelSelection: (...args: unknown[]) => mocks.commitModelSelection(...args),
		writeProviderConfig: (...args: unknown[]) => mocks.writeProviderConfig(...args),
		readProviderConfig: vi.fn(async () => mocks.providerConfig ?? {}),
		probeOllamaContext: (...args: unknown[]) => mocks.probeOllamaContext(...args),
		updateApiConfigurationProto: (...args: unknown[]) => mocks.updateApiConfigurationProto(...args),
	},
}))

vi.mock("../cline-rules/ClineRulesToggleModal", () => ({ default: () => null }))
vi.mock("./ServersToggleModal", () => ({ default: () => null }))

const PNG_DATA_URL = "data:image/png;base64,iVBORw0KGgo="

function renderTextArea(selectedImages: string[] = []) {
	const setSelectedImages = vi.fn()
	render(
		<ChatTextArea
			activeQuote={null}
			inputValue=""
			onSelectFilesAndImages={vi.fn()}
			onSend={vi.fn()}
			placeholderText="Type a message"
			selectedFiles={[]}
			selectedImages={selectedImages}
			sendingDisabled={false}
			setInputValue={vi.fn()}
			setSelectedFiles={vi.fn()}
			setSelectedImages={setSelectedImages}
			shouldDisableFilesAndImages={false}
		/>,
	)
	return { textarea: screen.getByPlaceholderText("Type a message"), setSelectedImages }
}

function pasteImage(target: HTMLElement) {
	const file = new File(["png"], "screenshot.png", { type: "image/png" })
	return fireEvent.paste(target, {
		clipboardData: {
			items: [{ kind: "file", type: "image/png", getAsFile: () => file }],
			getData: () => "",
		},
	})
}

describe("ChatTextArea image attachments vs. model capability", () => {
	beforeEach(() => {
		mocks.supportsImages = true
		mocks.navigateToSettingsModelPicker.mockReset()
	})

	it("still takes the image attach path on paste for a text-only model, without a refusal message", () => {
		mocks.supportsImages = false
		const { textarea } = renderTextArea()

		const notCanceled = pasteImage(textarea)

		expect(notCanceled).toBe(false) // preventDefault: the paste was handled as an image, not as text
		expect(screen.queryByText(/ignored/)).not.toBeInTheDocument()
	})

	it("badges attached images and offers a model switch when the model is text-only", () => {
		mocks.supportsImages = false
		renderTextArea([PNG_DATA_URL, PNG_DATA_URL])

		const notice = screen.getByTestId("images-unsupported-notice")
		expect(notice).toHaveTextContent("text-only-model doesn't support images, so the 2 attached images will be ignored.")
		expect(screen.getAllByTestId("image-unsupported-badge")).toHaveLength(2)

		// A native button, so keyboard users get Enter/Space activation without extra handlers.
		const chooseModel = screen.getByRole("button", { name: "Choose an image-capable model" })
		expect(chooseModel.tagName).toBe("BUTTON")
		fireEvent.click(chooseModel)
		expect(mocks.navigateToSettingsModelPicker).toHaveBeenCalledWith({ targetSection: "api-config" })
	})

	it("uses singular wording for one image", () => {
		mocks.supportsImages = false
		renderTextArea([PNG_DATA_URL])

		expect(screen.getByTestId("images-unsupported-notice")).toHaveTextContent("the attached image will be ignored")
		expect(screen.getByTestId("images-unsupported-notice")).toHaveTextContent("or remove it.")
	})

	it("shows nothing extra when the model supports images", () => {
		renderTextArea([PNG_DATA_URL])

		expect(screen.queryByTestId("images-unsupported-notice")).not.toBeInTheDocument()
		expect(screen.queryByTestId("image-unsupported-badge")).not.toBeInTheDocument()
	})

	it("fails open when the model's image support is unknown", () => {
		mocks.supportsImages = undefined
		renderTextArea([PNG_DATA_URL])

		expect(screen.queryByTestId("images-unsupported-notice")).not.toBeInTheDocument()
	})

	it("shows nothing for a text-only model while no images are attached", () => {
		mocks.supportsImages = false
		renderTextArea()

		expect(screen.queryByTestId("images-unsupported-notice")).not.toBeInTheDocument()
	})
})

describe("ChatTextArea temperature adjustment", () => {
	beforeEach(() => {
		mocks.supportsImages = true
		mocks.selectedProvider = "ollama"
		mocks.selectedModelId = "llama3:latest"
		mocks.selectedModelInfo = { temperature: 0.8 }
		mocks.commitModelSelection.mockReset()
		mocks.navigateToSettingsModelPicker.mockReset()
	})

	it("renders temperature input and stepper buttons with max limit 2.0", () => {
		renderTextArea()

		const input = screen.getByTestId("temperature-input") as HTMLInputElement
		expect(input).toBeInTheDocument()
		expect(input.value).toBe("0.8")
		expect(input.getAttribute("min")).toBe("0")
		expect(input.getAttribute("max")).toBe("2")
		expect(input.getAttribute("title")).toBe("Temperature: 0.0 to 2.0 (default 0.8)")

		const container = input.closest('[title="Temperature: 0.0 - 2.0 (0.1 step, default 0.8)"]')
		expect(container).toBeInTheDocument()
	})

	it("allows stepping up to 2.0 and disables increment button at 2.0", async () => {
		mocks.selectedModelInfo = { temperature: 1.9 }
		renderTextArea()

		const incrementBtn = screen.getByTestId("temperature-increment")
		expect(incrementBtn).not.toBeDisabled()

		await act(async () => {
			fireEvent.click(incrementBtn)
		})
		expect(mocks.commitModelSelection).toHaveBeenCalledWith(
			expect.objectContaining({
				overrides: expect.objectContaining({
					temperature: 2.0,
				}),
			}),
		)

		const input = screen.getByTestId("temperature-input") as HTMLInputElement
		expect(input.value).toBe("2.0")
		expect(incrementBtn).toBeDisabled()
	})

	it("clamps direct input to 2.0 when exceeding upper limit", async () => {
		renderTextArea()

		const input = screen.getByTestId("temperature-input")
		await act(async () => {
			fireEvent.change(input, { target: { value: "2.5" } })
		})

		expect(mocks.commitModelSelection).toHaveBeenCalledWith(
			expect.objectContaining({
				overrides: expect.objectContaining({
					temperature: 2.0,
				}),
			}),
		)
	})

	it("disables decrement button at 0.0", () => {
		mocks.selectedModelInfo = { temperature: 0.0 }
		renderTextArea()

		const decrementBtn = screen.getByTestId("temperature-decrement")
		expect(decrementBtn).toBeDisabled()
	})
})

describe("ChatTextArea context size adjustment", () => {
	beforeEach(() => {
		mocks.supportsImages = true
		mocks.selectedProvider = "anthropic"
		mocks.selectedModelId = "claude-3-7-sonnet"
		mocks.selectedModelInfo = { contextWindow: 32768 }
		mocks.commitModelSelection.mockReset()
		mocks.navigateToSettingsModelPicker.mockReset()
	})

	it("renders context size slider with 42 increments and context size label", () => {
		renderTextArea()

		const slider = screen.getByTestId("context-size-slider")
		expect(slider).toBeInTheDocument()
		expect(slider.className).toContain("flex-1")

		const thumb = screen.getByRole("slider")
		expect(thumb).toBeInTheDocument()
		expect(thumb).toHaveAttribute("aria-valuemin", "0")
		expect(thumb).toHaveAttribute("aria-valuemax", "42")
		expect(thumb).toHaveAttribute("aria-valuenow", "22") // 32K is index 22 out of 42

		const label = screen.getByTestId("context-size-value")
		expect(label).toBeInTheDocument()
		expect(label).toHaveTextContent("32K")
		expect(label.className).not.toContain("min-w-[42px]")
		expect(label.className).not.toContain("text-right")
		expect(label.className).toContain("whitespace-nowrap")
	})

	it("steps to the next context size increment on slider ArrowRight", async () => {
		renderTextArea()

		const thumb = screen.getByRole("slider")
		await act(async () => {
			fireEvent.keyDown(thumb, { key: "ArrowRight" })
		})

		expect(mocks.commitModelSelection).toHaveBeenCalledWith(
			expect.objectContaining({
				overrides: expect.objectContaining({
					contextWindow: 40960,
				}),
			}),
		)
	})

	it("steps to the previous context size increment on slider ArrowLeft", async () => {
		renderTextArea()

		const thumb = screen.getByRole("slider")
		await act(async () => {
			fireEvent.keyDown(thumb, { key: "ArrowLeft" })
		})

		expect(mocks.commitModelSelection).toHaveBeenCalledWith(
			expect.objectContaining({
				overrides: expect.objectContaining({
					contextWindow: 28672,
				}),
			}),
		)
	})

	it("renders at minimum position (index 0) for 512", () => {
		mocks.selectedModelInfo = { contextWindow: 512 }
		renderTextArea()

		const thumb = screen.getByRole("slider")
		expect(thumb).toHaveAttribute("aria-valuenow", "0")

		const label = screen.getByTestId("context-size-value")
		expect(label).toHaveTextContent("512")
	})

	it("renders at maximum position (index 42) for 1048576 / 1024K", () => {
		mocks.selectedModelInfo = { contextWindow: 1048576 }
		renderTextArea()

		const thumb = screen.getByRole("slider")
		expect(thumb).toHaveAttribute("aria-valuenow", "42")

		const label = screen.getByTestId("context-size-value")
		expect(label).toHaveTextContent("1024K")
	})

	it("renders intermediate context sizes correctly (e.g. 1536 / 1.5K)", () => {
		mocks.selectedModelInfo = { contextWindow: 1536 }
		renderTextArea()

		const thumb = screen.getByRole("slider")
		expect(thumb).toHaveAttribute("aria-valuenow", "4")

		const label = screen.getByTestId("context-size-value")
		expect(label).toHaveTextContent("1.5K")
	})

	it("renders ideal context size indicator without 'Ideal' text label and allows 1-click snapping", async () => {
		mocks.selectedModelInfo = { contextWindow: 32768 }
		renderTextArea()

		const sliderIndicator = screen.getByTestId("slider-ideal-indicator")
		expect(sliderIndicator).toBeInTheDocument()
		// 32768 is index 22 of 42
		expect(sliderIndicator).toHaveStyle({ left: `${(22 / 42) * 100}%` })

		const infoBtn = screen.getByTestId("context-info-button")
		expect(infoBtn).toBeInTheDocument()

		// Move slider away first (e.g. to minimum 512)
		const thumb = screen.getByRole("slider")
		await act(async () => {
			fireEvent.keyDown(thumb, { key: "Home" })
		})

		// Now click the info button to snap back to 32K
		await act(async () => {
			fireEvent.click(infoBtn)
		})

		expect(mocks.commitModelSelection).toHaveBeenCalledWith(
			expect.objectContaining({
				overrides: expect.objectContaining({
					contextWindow: 32768,
				}),
			}),
		)
	})

	it("updates ideal context size and slider when model changes", async () => {
		mocks.selectedProvider = "ollama"
		mocks.selectedModelId = "llama3:8b"
		mocks.selectedModelInfo = { contextWindow: 8192 }
		mocks.ollamaModelDetails = {
			contextLength: 8192,
			parameterSize: "8.0B",
			quantizationLevel: "Q4_0",
		}

		const { rerender } = render(
			<ChatTextArea
				activeQuote={null}
				inputValue=""
				onSelectFilesAndImages={vi.fn()}
				onSend={vi.fn()}
				placeholderText="Type a message"
				selectedFiles={[]}
				selectedImages={[]}
				sendingDisabled={false}
				setInputValue={vi.fn()}
				setSelectedFiles={vi.fn()}
				setSelectedImages={vi.fn()}
				shouldDisableFilesAndImages={false}
			/>,
		)

		// Wait for details effect to set context size to 8K
		const thumb = await screen.findByRole("slider")
		// 8192 is index 14 in CONTEXT_SIZES
		expect(thumb).toHaveAttribute("aria-valuenow", "14")
		expect(screen.getByTestId("context-size-value")).toHaveTextContent("8K")

		// Now change model to a larger model with 128K context
		mocks.selectedModelId = "llama3.1:8b"
		mocks.ollamaModelDetails = {
			contextLength: 131072,
			parameterSize: "8.0B",
			quantizationLevel: "Q4_0",
		}

		await act(async () => {
			rerender(
				<ChatTextArea
					activeQuote={null}
					inputValue=""
					onSelectFilesAndImages={vi.fn()}
					onSend={vi.fn()}
					placeholderText="Type a message"
					selectedFiles={[]}
					selectedImages={[]}
					sendingDisabled={false}
					setInputValue={vi.fn()}
					setSelectedFiles={vi.fn()}
					setSelectedImages={vi.fn()}
					shouldDisableFilesAndImages={false}
				/>,
			)
		})

		// 131072 is index 30 in CONTEXT_SIZES
		expect(thumb).toHaveAttribute("aria-valuenow", "30")
		expect(screen.getByTestId("context-size-value")).toHaveTextContent("128K")
	})
})

describe("ChatTextArea Ollama reasoning mode toggle", () => {
	beforeEach(() => {
		mocks.supportsImages = true
		mocks.selectedProvider = "ollama"
		mocks.selectedModelId = "llama3.2"
		mocks.selectedModelInfo = undefined
		mocks.commitModelSelection.mockReset()
		mocks.writeProviderConfig.mockReset()
	})

	it("hides reasoning toggle for non-reasoning Ollama models", () => {
		renderTextArea()
		expect(screen.queryByTestId("ollama-reasoning-toggle")).not.toBeInTheDocument()
	})

	it("shows reasoning toggle for reasoning Ollama models by model name pattern", () => {
		mocks.selectedModelId = "deepseek-r1:14b"
		renderTextArea()
		expect(screen.getByTestId("ollama-reasoning-toggle")).toBeInTheDocument()
		expect(screen.getByTestId("ollama-reasoning-toggle")).toHaveTextContent("Think: ON")
	})

	it("shows reasoning toggle when modelInfo explicitly supports reasoning", () => {
		mocks.selectedModelId = "custom-local-model"
		mocks.selectedModelInfo = { supportsReasoning: true }
		renderTextArea()
		expect(screen.getByTestId("ollama-reasoning-toggle")).toBeInTheDocument()
	})

	it("hides reasoning toggle for non-Ollama providers even with reasoning model ID", () => {
		mocks.selectedProvider = "anthropic"
		mocks.selectedModelId = "deepseek-r1:14b"
		renderTextArea()
		expect(screen.queryByTestId("ollama-reasoning-toggle")).not.toBeInTheDocument()
	})

	it("toggles reasoning state and writes provider config when clicked", async () => {
		mocks.selectedModelId = "deepseek-r1:14b"
		renderTextArea()

		const toggleBtn = screen.getByTestId("ollama-reasoning-toggle")
		expect(toggleBtn).toHaveTextContent("Think: ON")

		await act(async () => {
			fireEvent.click(toggleBtn)
		})

		expect(toggleBtn).toHaveTextContent("Think: OFF")
		expect(mocks.writeProviderConfig).toHaveBeenCalledWith(
			expect.objectContaining({
				providerId: "ollama",
				patch: expect.objectContaining({
					reasoning: expect.objectContaining({
						enabled: false,
					}),
				}),
			}),
		)
	})
})

describe("ChatTextArea telemetry breakdown", () => {
	beforeEach(() => {
		mocks.supportsImages = true
		mocks.selectedProvider = "ollama"
		mocks.selectedModelId = "deepseek-r1:14b"
		mocks.clineMessages = []
	})

	it("displays decoded inference speed from latest message", () => {
		mocks.clineMessages = [
			{
				ts: 1000,
				type: "say",
				say: "api_req_finished",
				text: JSON.stringify({
					tokensPerSecond: 28.4,
					tokensIn: 512,
					tokensOut: 128,
					durationMs: 4500,
					promptEvalTokensPerSecond: 180.2,
				}),
			},
		]

		renderTextArea()

		const badge = screen.getByTestId("inference-speed")
		const modeSwitch = screen.getByTestId("mode-switch")
		expect(badge).toBeInTheDocument()
		expect(badge).toHaveTextContent("28.4 t/s")
		expect(modeSwitch.closest(".shrink-0")).toContainElement(badge)
	})

	it("does not hide tokens per second badge for ollama provider even without messages", () => {
		mocks.clineMessages = []
		renderTextArea()

		const badge = screen.getByTestId("inference-speed")
		expect(badge).toBeInTheDocument()
		expect(badge).toHaveTextContent("-- t/s")
	})

	it("does not hide tokens per second badge for llama provider even without messages", () => {
		mocks.selectedProvider = "llama"
		mocks.clineMessages = []
		renderTextArea()

		const badge = screen.getByTestId("inference-speed")
		expect(badge).toBeInTheDocument()
		expect(badge).toHaveTextContent("-- t/s")
	})

	it("hides tokens per second badge for non-llama providers when there is no telemetry", () => {
		mocks.selectedProvider = "anthropic"
		mocks.clineMessages = []
		renderTextArea()

		expect(screen.queryByTestId("inference-speed")).not.toBeInTheDocument()
	})
})

describe("ChatTextArea Ollama Phase 2 architecture & capabilities inspector", () => {
	beforeEach(() => {
		mocks.supportsImages = true
		mocks.selectedProvider = "ollama"
		mocks.selectedModelId = "qwen2.5-coder:14b"
		mocks.ollamaModelDetails = {
			format: "gguf",
			family: "qwen2",
			parameterSize: "14.7B",
			quantizationLevel: "Q4_K_M",
			contextLength: 32768,
			supportsTools: true,
			supportsVision: true,
		}
	})

	it("renders context info button with architecture specs and verified capability badges", async () => {
		renderTextArea()

		const infoBtn = await screen.findByTestId("context-info-button")
		expect(infoBtn).toBeInTheDocument()
		expect(infoBtn).toHaveAttribute("title", expect.stringContaining("14.7B"))
		expect(infoBtn).toHaveAttribute("title", expect.stringContaining("Q4_K_M"))

		const toolsBadge = screen.getByTestId("model-tools-badge")
		expect(toolsBadge).toBeInTheDocument()
		expect(toolsBadge).toHaveTextContent("Tools")

		const visionBadge = screen.getByTestId("model-vision-badge")
		expect(visionBadge).toBeInTheDocument()
		expect(visionBadge).toHaveTextContent("Vision")
	})
})

describe("ChatTextArea Ollama Phase 2 native context guard", () => {
	beforeEach(() => {
		mocks.supportsImages = true
		mocks.selectedProvider = "ollama"
		mocks.selectedModelId = "llama3:8b"
	})

	it("indicates warning on info button when configured context exceeds native context window", async () => {
		// Context defaults to 32K (32768) if unspecified
		mocks.ollamaModelDetails = {
			contextLength: 8192,
			parameterSize: "8.0B",
			quantizationLevel: "Q4_0",
		}

		renderTextArea()

		const infoBtn = await screen.findByTestId("context-info-button")
		expect(infoBtn).toBeInTheDocument()
		expect(infoBtn).toHaveAttribute("title", expect.stringContaining("Exceeds model native context limit"))
		expect(infoBtn).toHaveAttribute("aria-label", expect.stringContaining("exceeds native limit"))
	})

	it("indicates normal status on info button when within native context window", async () => {
		mocks.ollamaModelDetails = {
			contextLength: 65536,
			parameterSize: "8.0B",
			quantizationLevel: "Q4_0",
		}

		renderTextArea()

		const infoBtn = await screen.findByTestId("context-info-button")
		expect(infoBtn).toBeInTheDocument()
		expect(infoBtn).toHaveAttribute("title", expect.stringContaining("64K"))
		expect(infoBtn).not.toHaveAttribute("title", expect.stringContaining("Exceeds model native context limit"))
	})
})

describe("ChatTextArea Ollama Phase 2 sampling controls & verbose layout", () => {
	beforeEach(() => {
		mocks.supportsImages = true
		mocks.selectedProvider = "ollama"
		mocks.selectedModelId = "llama3:latest"
		mocks.ollamaModelDetails = undefined
		localStorage.clear()
	})

	it("renders verbose labels for Context, Temperature, and GPU status", () => {
		renderTextArea()

		expect(screen.getByText("Context:")).toBeInTheDocument()
		expect(screen.getByText("Temp")).toBeInTheDocument()
		expect(screen.getByTestId("gpu-cpu-ratio")).toHaveTextContent("GPU: 100% (Idle)")
	})

	it("toggles deterministic seed on and off", async () => {
		renderTextArea()

		const seedBtn = screen.getByTestId("ollama-seed-toggle")
		expect(seedBtn).toHaveTextContent("Seed: Off")

		await act(async () => {
			fireEvent.click(seedBtn)
		})
		expect(seedBtn).toHaveTextContent("Seed: 42")

		await act(async () => {
			fireEvent.click(seedBtn)
		})
		expect(seedBtn).toHaveTextContent("Seed: Off")
	})

	it("adjusts Min-P sampling via stepper buttons", async () => {
		renderTextArea()

		const minPInput = screen.getByTestId("min-p-input") as HTMLInputElement
		expect(minPInput.value).toBe("0.00")

		const incrementBtn = screen.getByTestId("min-p-increment")
		await act(async () => {
			fireEvent.click(incrementBtn)
		})
		expect(minPInput.value).toBe("0.05")

		const decrementBtn = screen.getByTestId("min-p-decrement")
		await act(async () => {
			fireEvent.click(decrementBtn)
		})
		expect(minPInput.value).toBe("0.00")
	})
})

describe("ChatTextArea Ollama GPU autotune", () => {
	beforeEach(() => {
		mocks.supportsImages = true
		mocks.selectedProvider = "ollama"
		mocks.selectedModelId = "llama3:8b"
		mocks.selectedModelInfo = { contextWindow: 16384 }
		mocks.commitModelSelection.mockReset()
		mocks.probeOllamaContext = vi.fn(async (req: any) => {
			// Simulating GPU capacity fitting up to 16,384 tokens
			const fits = req.contextWindow <= 16384
			return {
				success: true,
				fitsOnGpu: fits,
				gpuPercent: fits ? 100 : 75,
				sizeVram: fits ? 5000000000 : 3750000000,
				size: 5000000000,
			}
		})
	})

	it("renders Tune button for Ollama provider", () => {
		renderTextArea()
		const autotuneBtn = screen.getByTestId("ollama-autotune-button")
		expect(autotuneBtn).toBeInTheDocument()
		expect(autotuneBtn).toHaveTextContent("Tune")
	})

	it("hides Tune button for non-Ollama providers", () => {
		mocks.selectedProvider = "anthropic"
		renderTextArea()
		expect(screen.queryByTestId("ollama-autotune-button")).not.toBeInTheDocument()
	})

	it("runs autotune calibration when clicked, shows live status, and sets optimal context size", async () => {
		renderTextArea()
		const autotuneBtn = screen.getByTestId("ollama-autotune-button")

		await act(async () => {
			fireEvent.click(autotuneBtn)
		})

		// Model's ideal context is 16384 tokens and fits on GPU
		expect(mocks.probeOllamaContext).toHaveBeenCalledWith(
			expect.objectContaining({
				modelName: "llama3:8b",
				contextWindow: 16384,
			}),
		)

		// Should have committed the optimal context window (16384)
		expect(mocks.commitModelSelection).toHaveBeenCalledWith(
			expect.objectContaining({
				overrides: expect.objectContaining({
					contextWindow: 16384,
				}),
			}),
		)
		expect(screen.getByTestId("context-size-value")).toHaveTextContent("16K")
		// Button shows tuned status on completion and stays green
		expect(autotuneBtn).toHaveTextContent("Tuned")
		expect(autotuneBtn).toHaveClass("text-emerald-500")

		// GPU/CPU ratio badge updates to show 100% GPU utilized (not Idle)
		const gpuRatio = screen.getByTestId("gpu-cpu-ratio")
		expect(gpuRatio).toHaveTextContent("GPU: 100%")
		expect(gpuRatio).not.toHaveTextContent("Idle")
	})

	it("adjusts context window downwards by 4028 when initial size exceeds GPU capacity", async () => {
		mocks.selectedModelInfo = { contextWindow: 32768 }
		mocks.probeOllamaContext = vi.fn(async (req: any) => {
			const fits = req.contextWindow <= 16384
			return {
				success: true,
				fitsOnGpu: fits,
				gpuPercent: fits ? 100 : 60,
				sizeVram: fits ? 4000000000 : 2400000000,
				size: 4000000000,
			}
		})

		renderTextArea()
		const autotuneBtn = screen.getByTestId("ollama-autotune-button")

		await act(async () => {
			fireEvent.click(autotuneBtn)
		})

		// Should have probed 32768 first (model ideal)
		expect(mocks.probeOllamaContext).toHaveBeenCalledWith(
			expect.objectContaining({
				modelName: "llama3:8b",
				contextWindow: 32768,
			}),
		)
		// Stepped down by 4028
		expect(mocks.probeOllamaContext).toHaveBeenCalledWith(
			expect.objectContaining({
				modelName: "llama3:8b",
				contextWindow: 32768 - 4028,
			}),
		)

		expect(autotuneBtn).toHaveTextContent("Tuned")
		expect(autotuneBtn).toHaveClass("text-emerald-500")
	})

	it("displays error status in button and detailed tooltip when autotuning fails", async () => {
		mocks.probeOllamaContext = vi.fn(async () => ({
			success: false,
			fitsOnGpu: false,
			gpuPercent: 0,
			error: "connect ECONNREFUSED 127.0.0.1:11434",
		}))

		renderTextArea()
		const autotuneBtn = screen.getByTestId("ollama-autotune-button")

		await act(async () => {
			fireEvent.click(autotuneBtn)
		})

		expect(autotuneBtn).toHaveTextContent("Failed")
		expect(autotuneBtn).toHaveClass("text-red-500")
		expect(autotuneBtn).toHaveAttribute("aria-label", expect.stringContaining("Cannot connect to Ollama"))
		expect(autotuneBtn).toHaveAttribute("aria-label", expect.stringContaining("ollama serve"))
	})

	it("allows cancelling autotuning mid-calibration", async () => {
		mocks.probeOllamaContext = vi.fn(() => new Promise(() => {})) // Never resolves

		renderTextArea()
		const autotuneBtn = screen.getByTestId("ollama-autotune-button")

		// Start autotuning
		await act(async () => {
			fireEvent.click(autotuneBtn)
		})

		// Button shows live testing state while running
		expect(autotuneBtn).toHaveTextContent(/Testing|Starting/)

		// Clicking while running triggers cancellation
		await act(async () => {
			fireEvent.click(autotuneBtn)
		})

		// Returns to idle Tune label
		expect(autotuneBtn).toHaveTextContent("Tune")
	})
})

describe("ChatTextArea Ollama settings persistence", () => {
	beforeEach(() => {
		mocks.selectedProvider = "ollama"
		mocks.selectedModelId = "deepseek-r1:8b"
		mocks.selectedModelInfo = {
			contextWindow: 32768,
			supportsReasoning: true,
		}
		mocks.apiConfiguration = {}
		mocks.updateApiConfigurationProto.mockClear()
	})

	it("restores persisted temperature from apiConfiguration", () => {
		mocks.apiConfiguration = {
			ollamaTemperature: 1.4,
		}

		renderTextArea()
		const input = screen.getByTestId("temperature-input") as HTMLInputElement
		expect(input.value).toBe("1.4")
	})

	it("persists temperature changes to apiConfiguration", async () => {
		renderTextArea()
		const incrementBtn = screen.getByTestId("temperature-increment")

		await act(async () => {
			fireEvent.click(incrementBtn)
		})

		expect(mocks.updateApiConfigurationProto).toHaveBeenCalledWith(
			expect.objectContaining({
				apiConfiguration: expect.objectContaining({
					ollamaTemperature: 0.9,
				}),
			}),
		)
	})

	it("restores persisted Min-P from apiConfiguration", () => {
		mocks.apiConfiguration = {
			ollamaMinP: 0.25,
		}

		renderTextArea()
		const input = screen.getByTestId("min-p-input") as HTMLInputElement
		expect(input.value).toBe("0.25")
	})

	it("persists Min-P changes to apiConfiguration", async () => {
		renderTextArea()
		const incrementBtn = screen.getByTestId("min-p-increment")

		await act(async () => {
			fireEvent.click(incrementBtn)
		})

		expect(mocks.updateApiConfigurationProto).toHaveBeenCalledWith(
			expect.objectContaining({
				apiConfiguration: expect.objectContaining({
					ollamaMinP: 0.05,
				}),
			}),
		)
	})

	it("restores persisted deterministic seed from apiConfiguration", () => {
		mocks.apiConfiguration = {
			ollamaSeedEnabled: true,
			ollamaSeedValue: 999,
		}

		renderTextArea()
		const seedToggle = screen.getByTestId("ollama-seed-toggle")
		expect(seedToggle).toHaveTextContent("Seed: 999")
	})

	it("persists deterministic seed toggle to apiConfiguration", async () => {
		renderTextArea()
		const seedToggle = screen.getByTestId("ollama-seed-toggle")

		await act(async () => {
			fireEvent.click(seedToggle)
		})

		expect(mocks.updateApiConfigurationProto).toHaveBeenCalledWith(
			expect.objectContaining({
				apiConfiguration: expect.objectContaining({
					ollamaSeedEnabled: true,
				}),
			}),
		)
	})

	it("restores persisted reasoning mode from apiConfiguration", () => {
		mocks.apiConfiguration = {
			ollamaReasoning: false,
		}

		renderTextArea()
		const reasoningToggle = screen.getByTestId("ollama-reasoning-toggle")
		expect(reasoningToggle).toHaveTextContent("Think: OFF")
	})

	it("persists reasoning mode toggle to apiConfiguration", async () => {
		mocks.apiConfiguration = {
			ollamaReasoning: true,
		}

		renderTextArea()
		const reasoningToggle = screen.getByTestId("ollama-reasoning-toggle")

		await act(async () => {
			fireEvent.click(reasoningToggle)
		})

		expect(mocks.updateApiConfigurationProto).toHaveBeenCalledWith(
			expect.objectContaining({
				apiConfiguration: expect.objectContaining({
					ollamaReasoning: false,
				}),
			}),
		)
	})

	it("restores persisted tuned status from apiConfiguration on reload", () => {
		mocks.apiConfiguration = {
			ollamaIsTuned: true,
			ollamaTunedContextSize: 16384,
			ollamaTunedModel: "deepseek-r1:8b",
		}

		renderTextArea()
		const autotuneBtn = screen.getByTestId("ollama-autotune-button")
		expect(autotuneBtn).toHaveTextContent("Tuned")
		expect(autotuneBtn).toHaveClass("text-emerald-500")

		const gpuBadge = screen.getByTestId("gpu-cpu-ratio")
		expect(gpuBadge).toHaveTextContent("GPU: 100%")

		// Slider value is updated to autotuned context size
		const label = screen.getByTestId("context-size-value")
		expect(label).toHaveTextContent("16K")

		// Green marker is rendered on slider track
		const tunedIndicator = screen.getByTestId("slider-tuned-indicator")
		expect(tunedIndicator).toBeInTheDocument()
		expect(tunedIndicator).toHaveClass("bg-emerald-500")
		// 16384 is index 18 of 42
		expect(tunedIndicator).toHaveStyle({ left: `${(18 / 42) * 100}%` })
	})

	it("snaps context slider to nearest config value on initial load", () => {
		// Model info specifies arbitrary unaligned 8000 tokens
		mocks.selectedModelInfo = { contextWindow: 8000 }
		renderTextArea()

		// Nearest step in CONTEXT_SIZES to 8000 is 8192 (8K, index 14)
		const thumb = screen.getByRole("slider")
		expect(thumb).toHaveAttribute("aria-valuenow", "14")

		const label = screen.getByTestId("context-size-value")
		expect(label).toHaveTextContent("8K")
	})

	it("snaps context slider to nearest autotuned config value on load", () => {
		// apiConfiguration specifies arbitrary unaligned 16000 tokens
		mocks.apiConfiguration = {
			ollamaIsTuned: true,
			ollamaTunedContextSize: 16000,
			ollamaTunedModel: "deepseek-r1:8b",
		}
		renderTextArea()

		// Nearest step to 16000 is 16384 (16K, index 18)
		const thumb = screen.getByRole("slider")
		expect(thumb).toHaveAttribute("aria-valuenow", "18")

		const label = screen.getByTestId("context-size-value")
		expect(label).toHaveTextContent("16K")

		const tunedIndicator = screen.getByTestId("slider-tuned-indicator")
		expect(tunedIndicator).toBeInTheDocument()
		expect(tunedIndicator).toHaveStyle({ left: `${(18 / 42) * 100}%` })
	})

	it("preserves green tuned marker when user adjusts slider and allows 1-click snap back", async () => {
		mocks.apiConfiguration = {
			ollamaIsTuned: true,
			ollamaTunedContextSize: 16384,
			ollamaTunedModel: "deepseek-r1:8b",
		}

		renderTextArea()
		const tunedIndicator = screen.getByTestId("slider-tuned-indicator")
		expect(tunedIndicator).toBeInTheDocument()

		// Adjust slider away (e.g. step down)
		const thumb = screen.getByRole("slider")
		await act(async () => {
			fireEvent.keyDown(thumb, { key: "ArrowLeft" })
		})

		// Slider has moved to 14K (index 17)
		expect(thumb).toHaveAttribute("aria-valuenow", "17")
		expect(screen.getByTestId("context-size-value")).toHaveTextContent("14K")

		// Green marker is STILL rendered at 16K to discourage adjusting and guide user back
		expect(screen.getByTestId("slider-tuned-indicator")).toBeInTheDocument()
		expect(screen.getByTestId("slider-tuned-indicator")).toHaveStyle({ left: `${(18 / 42) * 100}%` })

		// Button shows idle Tune since context was moved away
		const autotuneBtn = screen.getByTestId("ollama-autotune-button")
		expect(autotuneBtn).toHaveTextContent("Tune")

		// Click the green marker to snap slider back to autotuned context size
		await act(async () => {
			fireEvent.click(screen.getByTestId("slider-tuned-indicator"))
		})

		// Slider snaps back to 16K
		expect(screen.getByRole("slider")).toHaveAttribute("aria-valuenow", "18")
		expect(screen.getByTestId("context-size-value")).toHaveTextContent("16K")

		// Restores Tuned status
		expect(autotuneBtn).toHaveTextContent("Tuned")
		expect(autotuneBtn).toHaveClass("text-emerald-500")
	})

	it("updates slider value to autotuned context and adds green marker on autotune completion", async () => {
		mocks.selectedModelInfo = { contextWindow: 8192 }
		mocks.probeOllamaContext = vi.fn(async () => ({
			success: true,
			fitsOnGpu: true,
			gpuPercent: 100,
			sizeVram: 4000000000,
			size: 4000000000,
		}))

		renderTextArea()
		expect(screen.queryByTestId("slider-tuned-indicator")).not.toBeInTheDocument()

		const autotuneBtn = screen.getByTestId("ollama-autotune-button")
		await act(async () => {
			fireEvent.click(autotuneBtn)
		})

		// Slider value is updated to autotuned context size
		expect(screen.getByTestId("context-size-value")).toHaveTextContent("8K")
		expect(autotuneBtn).toHaveTextContent("Tuned")

		// Green marker is now rendered on slider track
		const tunedIndicator = screen.getByTestId("slider-tuned-indicator")
		expect(tunedIndicator).toBeInTheDocument()
		expect(tunedIndicator).toHaveClass("bg-emerald-500")
	})

	it("does not overwrite tuned context size with ideal context size when getOllamaModelDetails resolves on load", async () => {
		mocks.apiConfiguration = {
			ollamaIsTuned: true,
			ollamaTunedContextSize: 16384,
			ollamaTunedModel: "deepseek-r1:8b",
			ollamaApiOptionsCtxNum: "16384",
		}
		mocks.selectedProvider = "ollama"
		mocks.selectedModelId = "deepseek-r1:8b"
		mocks.selectedModelInfo = { contextWindow: 32768 }
		mocks.ollamaModelDetails = {
			contextLength: 32768, // Ideal is 32K, but tuned is 16K
			parameterSize: "8.0B",
			quantizationLevel: "Q4_0",
		}

		renderTextArea()

		// Slider must remain set to 16K (index 18) and NOT reset to ideal 32K (index 22)
		const thumb = await screen.findByRole("slider")
		expect(thumb).toHaveAttribute("aria-valuenow", "18")
		expect(screen.getByTestId("context-size-value")).toHaveTextContent("16K")

		// Green tuned indicator is at 16K (index 18)
		const tunedIndicator = screen.getByTestId("slider-tuned-indicator")
		expect(tunedIndicator).toBeInTheDocument()
		expect(tunedIndicator).toHaveStyle({ left: `${(18 / 42) * 100}%` })

		// Ideal indicator is at 32K (index 22)
		const idealIndicator = screen.getByTestId("slider-ideal-indicator")
		expect(idealIndicator).toBeInTheDocument()
		expect(idealIndicator).toHaveStyle({ left: `${(22 / 42) * 100}%` })
	})

	it("sets context slider to Model Context Window config value on load instead of ideal", async () => {
		mocks.apiConfiguration = {
			ollamaApiOptionsCtxNum: "16384",
		}
		mocks.selectedProvider = "ollama"
		mocks.selectedModelId = "deepseek-r1:8b"
		mocks.selectedModelInfo = { contextWindow: 32768 }
		mocks.ollamaModelDetails = {
			contextLength: 32768,
		}

		renderTextArea()

		// Slider must initialize to Model Context Window 16K (index 18) instead of ideal 32K
		const thumb = await screen.findByRole("slider")
		expect(thumb).toHaveAttribute("aria-valuenow", "18")
		expect(screen.getByTestId("context-size-value")).toHaveTextContent("16K")
	})
})

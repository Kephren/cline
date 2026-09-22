import { act, fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import ChatTextArea from "./ChatTextArea"

const mocks = vi.hoisted(() => ({
	supportsImages: true as boolean | undefined,
	selectedProvider: "anthropic",
	selectedModelId: "text-only-model",
	selectedModelInfo: undefined as Record<string, unknown> | undefined,
	commitModelSelection: vi.fn(async () => ({})),
	navigateToSettingsModelPicker: vi.fn(),
}))

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({
		mode: "act",
		apiConfiguration: {},
		openRouterModels: {},
		platform: "darwin",
		localWorkflowToggles: {},
		globalWorkflowToggles: {},
		remoteWorkflowToggles: {},
		remoteConfigSettings: undefined,
		navigateToSettingsModelPicker: mocks.navigateToSettingsModelPicker,
		mcpServers: [],
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
		commitModelSelection: (...args: unknown[]) => mocks.commitModelSelection(...args),
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

	it("renders context size slider with 20 increments and context size label", () => {
		renderTextArea()

		const slider = screen.getByTestId("context-size-slider")
		expect(slider).toBeInTheDocument()
		expect(slider.className).toContain("flex-1")

		const thumb = screen.getByRole("slider")
		expect(thumb).toBeInTheDocument()
		expect(thumb).toHaveAttribute("aria-valuemin", "0")
		expect(thumb).toHaveAttribute("aria-valuemax", "20")
		expect(thumb).toHaveAttribute("aria-valuenow", "10") // 32K is index 10

		const label = screen.getByTestId("context-size-value")
		expect(label).toBeInTheDocument()
		expect(label).toHaveTextContent("32K")
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
					contextWindow: 49152,
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
					contextWindow: 24576,
				}),
			}),
		)
	})

	it("renders at minimum position (index 0) for 1024 / 1K", () => {
		mocks.selectedModelInfo = { contextWindow: 1024 }
		renderTextArea()

		const thumb = screen.getByRole("slider")
		expect(thumb).toHaveAttribute("aria-valuenow", "0")

		const label = screen.getByTestId("context-size-value")
		expect(label).toHaveTextContent("1K")
	})

	it("renders at maximum position (index 20) for 1048576 / 1024K", () => {
		mocks.selectedModelInfo = { contextWindow: 1048576 }
		renderTextArea()

		const thumb = screen.getByRole("slider")
		expect(thumb).toHaveAttribute("aria-valuenow", "20")

		const label = screen.getByTestId("context-size-value")
		expect(label).toHaveTextContent("1024K")
	})

	it("renders intermediate half-step context size correctly (e.g. 1536 / 1.5K)", () => {
		mocks.selectedModelInfo = { contextWindow: 1536 }
		renderTextArea()

		const thumb = screen.getByRole("slider")
		expect(thumb).toHaveAttribute("aria-valuenow", "1")

		const label = screen.getByTestId("context-size-value")
		expect(label).toHaveTextContent("1.5K")
	})
})

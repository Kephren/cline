import { ClineMessage } from "@shared/ExtensionMessage"
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { StickyUserMessage } from "./StickyUserMessage"

describe("StickyUserMessage", () => {
	it("does not render when lastUserMessage is null", () => {
		const { container } = render(<StickyUserMessage isVisible={true} lastUserMessage={null} />)
		expect(container.firstChild).toBeNull()
	})

	it("does not render when isVisible is false", () => {
		const message: ClineMessage = {
			ts: 1,
			type: "say",
			say: "user_feedback",
			text: "Fix the build",
		}
		const { container } = render(<StickyUserMessage isVisible={false} lastUserMessage={message} />)
		expect(container.firstChild).toBeNull()
	})

	it("does not render when message text and attachments are completely empty", () => {
		const message: ClineMessage = {
			ts: 1,
			type: "say",
			say: "user_feedback",
			text: "   ",
		}
		const { container } = render(<StickyUserMessage isVisible={true} lastUserMessage={message} />)
		expect(container.firstChild).toBeNull()
	})

	it("renders pinned prompt with label, text, and role button", () => {
		const message: ClineMessage = {
			ts: 100,
			type: "say",
			say: "user_feedback",
			text: "Add login with Google button",
		}
		render(<StickyUserMessage isVisible={true} lastUserMessage={message} />)

		const element = screen.getByTestId("pinned-last-prompt")
		expect(element).toBeInTheDocument()
		expect(element).toHaveTextContent("Prompt:")
		expect(element).toHaveTextContent("Add login with Google button")
		expect(element).toHaveAttribute("title", "Click to scroll to prompt:\nAdd login with Google button")
		expect(element).toHaveAttribute("aria-label", "Scroll to prompt: Add login with Google button")
	})

	it("shows attachment indicator when images or files are attached", () => {
		const messageWithFiles: ClineMessage = {
			ts: 101,
			type: "say",
			say: "user_feedback",
			text: "Inspect these logs",
			files: ["/path/to/log.txt"],
		}
		const { container } = render(<StickyUserMessage isVisible={true} lastUserMessage={messageWithFiles} />)
		expect(screen.getByTestId("pinned-last-prompt")).toBeInTheDocument()
		// PaperclipIcon svg should be rendered
		const svgIcons = container.querySelectorAll("svg")
		expect(svgIcons.length).toBeGreaterThanOrEqual(2) // PinIcon + PaperclipIcon
	})

	it("invokes onScrollToMessage when clicked", () => {
		const onScroll = vi.fn()
		const message: ClineMessage = {
			ts: 102,
			type: "say",
			say: "user_feedback",
			text: "Review this PR",
		}
		render(<StickyUserMessage isVisible={true} lastUserMessage={message} onScrollToMessage={onScroll} />)

		fireEvent.click(screen.getByTestId("pinned-last-prompt"))
		expect(onScroll).toHaveBeenCalledTimes(1)
	})

	it("invokes onScrollToMessage when pressing Enter or Space", () => {
		const onScroll = vi.fn()
		const message: ClineMessage = {
			ts: 103,
			type: "say",
			say: "user_feedback",
			text: "Run tests",
		}
		render(<StickyUserMessage isVisible={true} lastUserMessage={message} onScrollToMessage={onScroll} />)

		const promptElement = screen.getByTestId("pinned-last-prompt")
		fireEvent.keyDown(promptElement, { key: "Enter" })
		expect(onScroll).toHaveBeenCalledTimes(1)

		fireEvent.keyDown(promptElement, { key: " " })
		expect(onScroll).toHaveBeenCalledTimes(2)
	})
})

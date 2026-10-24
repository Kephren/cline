import { fireEvent, render, screen } from "@testing-library/react"
import type { ButtonHTMLAttributes, PropsWithChildren } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import ContextWindow from "./ContextWindow"

vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeButton: ({ children, ...props }: PropsWithChildren<ButtonHTMLAttributes<HTMLButtonElement>>) => (
		<button {...props}>{children}</button>
	),
}))

vi.mock("@/components/ui/hover-card", () => ({
	HoverCard: ({ children }: PropsWithChildren) => <div>{children}</div>,
	HoverCardContent: ({ children }: PropsWithChildren) => <div>{children}</div>,
	HoverCardTrigger: ({ children }: PropsWithChildren) => <div>{children}</div>,
}))

vi.mock("@/components/ui/progress", () => ({
	Progress: ({ value }: { value?: number }) => (
		<div aria-label="Context window usage progress" role="progressbar">
			{value}
		</div>
	),
}))

vi.mock("@/components/ui/tooltip", () => ({
	Tooltip: ({ children }: PropsWithChildren) => <>{children}</>,
	TooltipContent: ({ children }: PropsWithChildren) => <div>{children}</div>,
	TooltipTrigger: ({ children }: PropsWithChildren) => <>{children}</>,
}))

vi.mock("@/components/ui/button", () => ({
	Button: ({ children, ...props }: PropsWithChildren<ButtonHTMLAttributes<HTMLButtonElement>>) => (
		<button {...props}>{children}</button>
	),
}))

vi.mock("@/services/grpc-client", () => ({
	SlashServiceClient: {
		condense: vi.fn().mockResolvedValue({}),
	},
}))

describe("ContextWindow", () => {
	beforeEach(() => vi.clearAllMocks())

	it("renders context used, maximum, and total session tokens", () => {
		render(
			<ContextWindow
				cacheReads={500}
				cacheWrites={1500}
				contextWindow={200_000}
				lastApiReqTotalTokens={25_000}
				tokensIn={10_000}
				tokensOut={5_000}
				useAutoCondense={false}
			/>,
		)

		// Context used
		expect(screen.getByText("25.0k")).toBeInTheDocument()
		// Maximum context window
		expect(screen.getByText("200.0k")).toBeInTheDocument()
		// Total tokens: 10,000 + 5,000 + 1,500 + 500 = 17,000 -> 17.0k
		expect(screen.getByText("Total: 17.0k")).toBeInTheDocument()
	})

	it("returns null if contextWindow is not provided or 0", () => {
		const { container } = render(
			<ContextWindow
				contextWindow={0}
				lastApiReqTotalTokens={25_000}
				tokensIn={10_000}
				tokensOut={5_000}
				useAutoCondense={false}
			/>,
		)

		expect(container.firstChild).toBeNull()
	})

	it("runs the shared compact handler after confirmation instead of sending /compact as a message", () => {
		const compactTask = vi.fn().mockResolvedValue(true)
		const onSendMessage = vi.fn()

		render(
			<ContextWindow
				compactDisabled={false}
				compactTask={compactTask}
				contextWindow={200_000}
				lastApiReqTotalTokens={25_000}
				onSendMessage={onSendMessage}
				tokensIn={10_000}
				tokensOut={5_000}
				useAutoCondense={false}
			/>,
		)

		fireEvent.click(screen.getByRole("button", { name: /compact task/i }))
		fireEvent.click(screen.getByRole("button", { name: /^compact$/i }))

		expect(compactTask).toHaveBeenCalledTimes(1)
		expect(onSendMessage).not.toHaveBeenCalled()
	})

	it("disables compaction during API error recovery", () => {
		render(
			<ContextWindow
				compactDisabled={true}
				compactTask={vi.fn()}
				contextWindow={200_000}
				lastApiReqTotalTokens={120_000}
				useAutoCondense={false}
			/>,
		)

		expect(screen.getByRole("button", { name: /compact task/i })).toBeDisabled()
	})
})

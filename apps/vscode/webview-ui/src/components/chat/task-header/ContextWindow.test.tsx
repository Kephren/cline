import { render, screen } from "@testing-library/react"
import type { ReactNode } from "react"
import { describe, expect, it, vi } from "vitest"
import ContextWindow from "./ContextWindow"

vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeButton: ({ children, disabled, onClick }: { children?: ReactNode; disabled?: boolean; onClick?: () => void }) => (
		<button disabled={disabled} onClick={onClick} type="button">
			{children}
		</button>
	),
}))

vi.mock("@/services/grpc-client", () => ({
	SlashServiceClient: {
		condense: vi.fn().mockResolvedValue({}),
	},
}))

describe("ContextWindow", () => {
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
})

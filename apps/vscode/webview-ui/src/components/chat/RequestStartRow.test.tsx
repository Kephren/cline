import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { ClineMessage } from "@shared/ExtensionMessage"
import { RequestStartRow } from "./RequestStartRow"

vi.mock("@/context/ClineAuthContext", () => ({
	useClineAuth: () => ({ clineUser: null }),
	useClineSignIn: () => ({
		isLoginLoading: false,
		authStatusMessage: "",
		handleSignIn: vi.fn(),
	}),
}))

describe("RequestStartRow", () => {
	const mockMessage: ClineMessage = {
		ts: Date.now(),
		type: "say",
		say: "api_req_started",
		text: JSON.stringify({ request: "test" }),
	}

	it("renders waiting indicator during initial pre state before reasoning or response", () => {
		render(
			<RequestStartRow
				message={mockMessage}
				clineMessages={[mockMessage]}
				isExpanded={false}
				handleToggle={vi.fn()}
			/>,
		)

		const waitingText = screen.getByText("Waiting for model response...")
		expect(waitingText).toBeInTheDocument()
		expect(waitingText).toHaveClass("animate-shimmer")
	})

	it("renders error message and timeout guidance when API request times out", () => {
		render(
			<RequestStartRow
				message={mockMessage}
				clineMessages={[mockMessage]}
				apiRequestFailedMessage="Connection timed out after 30 seconds"
				isExpanded={false}
				handleToggle={vi.fn()}
			/>,
		)

		expect(screen.getByText(/Connection timed out/i)).toBeInTheDocument()
		expect(screen.getByText(/The model request timed out before responding/i)).toBeInTheDocument()
	})
})

import { describe, expect, it } from "bun:test"
import * as vscode from "vscode"
import { registerAutocompleteProvider } from "../registerAutocompleteProvider"

describe("registerAutocompleteProvider", () => {
	it("creates status bar item with tooltip containing model name and context size", async () => {
		const mockStateManager = {
			getGlobalSettingsKey: (key: string) => {
				const map: Record<string, any> = {
					autocompleteEnabled: true,
					autocompleteShareWithChat: false,
					autocompleteBaseUrl: "http://192.168.80.170:11434",
					autocompleteModelId: "mannix/ornith-1.5-27b-a3b-coderx:Q3_K_M",
					autocompleteNumCtx: 65536,
				}
				return map[key]
			},
			getSecretKey: async () => undefined,
			setGlobalState: () => {},
		}

		let capturedStatusBarItem: any = null
		const originalCreateStatusBarItem = vscode.window.createStatusBarItem
		;(vscode.window as any).createStatusBarItem = (alignment: any, priority: any) => {
			const item = {
				alignment,
				priority,
				command: "",
				text: "",
				tooltip: undefined,
				color: undefined,
				show: () => {},
				dispose: () => {},
			}
			capturedStatusBarItem = item
			return item as any
		}

		const mockContext = {
			subscriptions: [],
		} as unknown as vscode.ExtensionContext

		const disposable = registerAutocompleteProvider(mockContext, { stateManager: mockStateManager })
		expect(disposable).toBeDefined()
		expect(capturedStatusBarItem).toBeDefined()

		// Wait for async updateStatusBar to finish
		await new Promise((r) => setTimeout(r, 50))

		expect(capturedStatusBarItem.text).toContain("Cline Autocomplete")
		expect(capturedStatusBarItem.tooltip).toBeDefined()

		const tooltipString = capturedStatusBarItem.tooltip?.value || String(capturedStatusBarItem.tooltip)
		expect(tooltipString).toContain("mannix/ornith-1.5-27b-a3b-coderx:Q3_K_M")
		expect(tooltipString).toContain("65,536 (64K)")
		expect(tooltipString).toContain("Enabled")
		expect(tooltipString).toContain("http://192.168.80.170:11434")

		disposable.dispose()
		vscode.window.createStatusBarItem = originalCreateStatusBarItem
	})
})

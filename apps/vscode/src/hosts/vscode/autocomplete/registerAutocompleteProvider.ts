import * as vscode from "vscode"
import type { StateProviderLike } from "./autocompleteConfig"
import { ClineInlineCompletionProvider } from "./InlineCompletionProvider"

export function registerAutocompleteProvider(
	context: vscode.ExtensionContext,
	stateProvider: StateProviderLike,
): vscode.Disposable {
	const disposables: vscode.Disposable[] = []

	const provider = new ClineInlineCompletionProvider(stateProvider)
	const selector: vscode.DocumentSelector = [{ scheme: "file" }, { scheme: "untitled" }, { pattern: "**" }]

	disposables.push(vscode.languages.registerInlineCompletionItemProvider(selector, provider))

	const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99)
	statusBarItem.command = "cline.toggleAutocomplete"

	const updateStatusBar = () => {
		const stateManager = stateProvider.stateManager || stateProvider.controller?.stateManager
		const enabled = stateManager?.getGlobalSettingsKey("autocompleteEnabled") ?? true
		statusBarItem.text = `$(sparkle) Cline Autocomplete`
		statusBarItem.tooltip = `Cline Inline Autocomplete is ${enabled ? "Enabled" : "Disabled"}. Click to toggle.`
		statusBarItem.color = enabled ? undefined : new vscode.ThemeColor("descriptionForeground")
	}

	updateStatusBar()
	statusBarItem.show()
	disposables.push(statusBarItem)

	disposables.push(
		vscode.commands.registerCommand("cline.toggleAutocomplete", async () => {
			const stateManager = stateProvider.stateManager || stateProvider.controller?.stateManager
			if (stateManager && stateManager.setGlobalState) {
				const current = stateManager.getGlobalSettingsKey("autocompleteEnabled") ?? true
				await stateManager.setGlobalState("autocompleteEnabled", !current)
				updateStatusBar()
				vscode.window.showInformationMessage(`Cline Autocomplete is now ${!current ? "enabled" : "disabled"}.`)
			}
		}),
	)

	return vscode.Disposable.from(...disposables)
}

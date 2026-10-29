import * as vscode from "vscode"
import { getEffectiveAutocompleteConfig, type StateProviderLike } from "./autocompleteConfig"
import { ClineInlineCompletionProvider } from "./InlineCompletionProvider"

export function registerAutocompleteProvider(
	context: vscode.ExtensionContext,
	stateProvider: StateProviderLike,
): vscode.Disposable {
	const disposables: vscode.Disposable[] = []

	const provider = new ClineInlineCompletionProvider(stateProvider)
	const selector: vscode.DocumentSelector = [{ scheme: "file" }, { scheme: "untitled" }, { pattern: "**" }]

	disposables.push(vscode.languages.registerInlineCompletionItemProvider(selector, provider))

	// Preload autocomplete model when the extension is first loaded with 30m keep_alive
	void provider.preloadOnStartup()

	const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99)
	statusBarItem.command = "cline.toggleAutocomplete"

	const updateStatusBar = async () => {
		const config = await getEffectiveAutocompleteConfig(stateProvider)
		statusBarItem.text = `$(sparkle) Cline Autocomplete`
		statusBarItem.color = config.enabled ? undefined : new vscode.ThemeColor("descriptionForeground")

		const ctxFormatted =
			config.numCtx >= 1024
				? `${config.numCtx.toLocaleString()} (${Math.round(config.numCtx / 1024)}K)`
				: `${config.numCtx}`

		const md = new vscode.MarkdownString("", true)
		md.isTrusted = true
		md.supportThemeIcons = true
		md.appendMarkdown(`**Cline Inline Autocomplete**\n\n`)
		md.appendMarkdown(`- **Status:** ${config.enabled ? "$(check) Enabled" : "$(x) Disabled"}\n`)
		md.appendMarkdown(`- **Model:** \`${config.modelId || "Not selected"}\`\n`)
		md.appendMarkdown(`- **Context Size:** ${ctxFormatted}\n`)
		if (config.baseUrl) {
			md.appendMarkdown(`- **Endpoint:** \`${config.baseUrl}\`\n`)
		}
		md.appendMarkdown(`\n---\n\n*Click to toggle*`)
		statusBarItem.tooltip = md
	}

	void updateStatusBar()
	statusBarItem.show()
	disposables.push(statusBarItem)

	disposables.push(
		vscode.window.onDidChangeActiveTextEditor(() => {
			void updateStatusBar()
		}),
	)

	disposables.push(
		vscode.window.onDidChangeWindowState((e) => {
			if (e.focused) {
				void updateStatusBar()
			}
		}),
	)

	disposables.push(
		vscode.commands.registerCommand("cline.toggleAutocomplete", async () => {
			const stateManager = stateProvider.stateManager || stateProvider.controller?.stateManager
			if (stateManager && stateManager.setGlobalState) {
				const current = stateManager.getGlobalSettingsKey("autocompleteEnabled") ?? true
				await stateManager.setGlobalState("autocompleteEnabled", !current)
				await updateStatusBar()
				vscode.window.showInformationMessage(`Cline Autocomplete is now ${!current ? "enabled" : "disabled"}.`)
			}
		}),
	)

	return vscode.Disposable.from(...disposables)
}

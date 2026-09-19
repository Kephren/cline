import { describe, expect, it } from "vitest"
import { isUnclosedCodeBlock } from "../MarkdownBlock"

describe("MarkdownBlock isUnclosedCodeBlock", () => {
	it("detects unclosed code fences correctly", () => {
		expect(isUnclosedCodeBlock("```python\ndef foo():\n  return 1")).toBe(true)
		expect(isUnclosedCodeBlock("```python\n")).toBe(true)
		expect(isUnclosedCodeBlock("```")).toBe(true)
		expect(isUnclosedCodeBlock("~~~javascript\nconst x = 1;")).toBe(true)
		expect(isUnclosedCodeBlock("````ts\n```js\nconsole.log(1)\n```")).toBe(true)
	})

	it("detects closed code fences correctly", () => {
		expect(isUnclosedCodeBlock("```python\ndef foo():\n  return 1\n```")).toBe(false)
		expect(isUnclosedCodeBlock("```\nhello\n```\n")).toBe(false)
		expect(isUnclosedCodeBlock("~~~js\nconsole.log(1)\n~~~")).toBe(false)
		expect(isUnclosedCodeBlock("````ts\n```js\nconsole.log(1)\n```\n````")).toBe(false)
	})

	it("returns false for non-code block content", () => {
		expect(isUnclosedCodeBlock("Hello world")).toBe(false)
		expect(isUnclosedCodeBlock("Inline `code` here")).toBe(false)
		expect(isUnclosedCodeBlock("# Header")).toBe(false)
	})
})

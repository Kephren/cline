/**
 * Shared utility functions for communicating with Ollama instances.
 */

/**
 * Normalizes an Ollama base URL string.
 * Supports handling URLs missing protocol slashes (e.g. "http:192.168.80.170:22434"),
 * bare host:port pairs (e.g. "192.168.80.170:22434"), trailing slashes, and "/api" or "/v1" suffixes.
 *
 * @param raw The raw URL string
 * @returns Clean normalized base URL string, or undefined if invalid
 */
export function normalizeOllamaUrl(raw?: string): string | undefined {
	if (!raw) return undefined
	let url = raw.trim()
	if (!url) return undefined

	// Normalize missing or malformed protocol
	if (!/^https?:\/\//i.test(url)) {
		if (/^https?:/i.test(url)) {
			url = `http://${url.replace(/^https?:?\/?\/?/i, "")}`
		} else if (/^[\w.-]+:\d+/i.test(url)) {
			url = `http://${url}`
		}
	}

	// Strip trailing slashes and common API suffixes
	url = url.replace(/\/+$/, "").replace(/\/(?:v1|api)$/i, "")

	return URL.canParse(url) ? url : undefined
}

/**
 * Normalizes an Ollama model name for comparison (strips whitespace, lowercase, strips :latest).
 */
export function normalizeOllamaModelName(name?: string): string {
	return (name || "")
		.trim()
		.toLowerCase()
		.replace(/:latest$/, "")
}

/**
 * Checks whether an Ollama error message represents an out-of-memory, resource exhaustion,
 * or context window limit condition that indicates a tested context size exceeds available capacity.
 */
export function isOllamaMemoryOrCapacityError(errMessage: string): boolean {
	return /out of memory|cuda|vram|not enough space|allocation|too large|system memory|insufficient|resource exhausted|cannot allocate|failed to allocate|failed to create context|terminated|exceed/i.test(
		errMessage,
	)
}

/**
 * Finds the running model in an Ollama /api/ps response matching targetModelName.
 */
export function findMatchingOllamaModel<T extends { name?: string; model?: string }>(
	models: T[],
	targetModelName: string,
): T | undefined {
	if (!models || models.length === 0) return undefined
	const target = normalizeOllamaModelName(targetModelName)

	const matched = models.find((m) => {
		const n = normalizeOllamaModelName(m.name)
		const mod = normalizeOllamaModelName(m.model)
		return (
			n === target ||
			mod === target ||
			n.endsWith(`/${target}`) ||
			mod.endsWith(`/${target}`) ||
			target.endsWith(`/${n}`) ||
			target.endsWith(`/${mod}`)
		)
	})

	if (matched) return matched
	if (models.length === 1) return models[0]
	return undefined
}

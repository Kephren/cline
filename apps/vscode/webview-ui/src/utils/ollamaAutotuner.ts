export interface AutotuneProbeResult {
	success: boolean
	fitsOnGpu: boolean
	gpuPercent: number
	sizeVram?: number
	size?: number
	error?: string
}

export type ProbeContextFunction = (contextSize: number) => Promise<AutotuneProbeResult>

export interface AutotuneStepProgress {
	step: number
	testingContext: number
	fitsOnGpu: boolean
	gpuPercent: number
	direction: "up" | "down"
	stepSize: number
}

export interface AutotuneOptions {
	initialContextSize: number
	probeFn: ProbeContextFunction
	onBeforeProbe?: (contextSize: number, step: number) => void
	onProgress?: (progress: AutotuneStepProgress) => void
	initialAdjustment?: number
	maxContextSize?: number
	minContextSize?: number
	minStepSize?: number
	signal?: AbortSignal
}

export interface AutotuneResult {
	optimalContextSize: number
	achievedAllGpu: boolean
	steps: AutotuneStepProgress[]
	message: string
}

/**
 * Autotunes an Ollama model's context window size to ensure 100% of the model and KV cache
 * fits on the GPU, bounded by the model's native limit (or maxContextSize).
 *
 * Algorithm:
 * 1. Starts with what is currently set on the context size slider (or native limit target).
 * 2. Samples Ollama: if 100% fits on GPU and is at maxContextSize, returns optimal fit.
 * 3. Starts adjustment by initialAdjustment (default 4028 tokens).
 * 4. Adjusts in halves of the last number (4028 -> 2014 -> 1007 -> stop when < 512).
 * 5. Returns optimal context size (highest tested size with 100% GPU offload, <= maxContextSize) or minContextSize (512).
 */
export async function runOllamaAutotune({
	initialContextSize,
	probeFn,
	onBeforeProbe,
	onProgress,
	initialAdjustment = 4028,
	maxContextSize,
	minContextSize = 512,
	minStepSize = 512,
	signal,
}: AutotuneOptions): Promise<AutotuneResult> {
	const steps: AutotuneStepProgress[] = []
	let currentContext = Math.max(minContextSize, Math.round(initialContextSize))
	if (maxContextSize && maxContextSize > 0) {
		currentContext = Math.min(maxContextSize, currentContext)
	}
	let bestFit = 0
	let stepCount = 0
	let delta = initialAdjustment

	// Step 1: Initial sample at current slider / target position
	if (signal?.aborted) throw new Error("Autotune aborted")
	stepCount++
	onBeforeProbe?.(currentContext, stepCount)
	const initialRes = await probeFn(currentContext)
	if (!initialRes.success) {
		throw new Error(initialRes.error || "Failed to communicate with Ollama")
	}

	const initialFits = initialRes.fitsOnGpu
	const currentDirection: "up" | "down" = initialFits ? "up" : "down"

	if (initialFits) {
		bestFit = currentContext
	}

	const initialProgress: AutotuneStepProgress = {
		step: stepCount,
		testingContext: currentContext,
		fitsOnGpu: initialFits,
		gpuPercent: initialRes.gpuPercent,
		direction: currentDirection,
		stepSize: delta,
	}
	steps.push(initialProgress)
	onProgress?.(initialProgress)

	// If initial sample fits and is already at maxContextSize (native limit), we're done!
	if (initialFits && maxContextSize && currentContext >= maxContextSize) {
		delta = 0
	} else if (currentDirection === "up") {
		currentContext = maxContextSize ? Math.min(maxContextSize, currentContext + delta) : currentContext + delta
	} else {
		if (currentContext <= minContextSize) {
			delta = 0
		} else {
			currentContext = Math.max(minContextSize, currentContext - delta)
		}
	}

	// Halving loop: adjust by halves of the last number (4028 -> 2014 -> 1007 -> ...)
	while (delta >= minStepSize) {
		if (signal?.aborted) throw new Error("Autotune aborted")

		stepCount++
		onBeforeProbe?.(currentContext, stepCount)
		const res = await probeFn(currentContext)
		if (!res.success) {
			throw new Error(res.error || "Failed to communicate with Ollama")
		}

		const fits = res.fitsOnGpu
		if (fits) {
			bestFit = Math.max(bestFit, currentContext)
		}

		// If it fits and has reached the max context size (native limit), stop
		if (fits && maxContextSize && currentContext >= maxContextSize) {
			break
		}

		const nextDirection: "up" | "down" = fits ? "up" : "down"
		delta = Math.floor(delta / 2)

		const progress: AutotuneStepProgress = {
			step: stepCount,
			testingContext: currentContext,
			fitsOnGpu: fits,
			gpuPercent: res.gpuPercent,
			direction: nextDirection,
			stepSize: delta,
		}
		steps.push(progress)
		onProgress?.(progress)

		if (delta < minStepSize) {
			break
		}

		if (nextDirection === "up") {
			currentContext = maxContextSize ? Math.min(maxContextSize, currentContext + delta) : currentContext + delta
		} else {
			if (currentContext <= minContextSize) {
				break
			}
			currentContext = Math.max(minContextSize, currentContext - delta)
		}
	}

	// If no fit was found yet (bestFit === 0), search downwards between minContextSize and the lowest tested context
	// to maximize the context size rather than prematurely settling on the minimum 512 tokens.
	if (bestFit === 0 && currentContext > minContextSize) {
		// First verify if minContextSize fits on GPU
		const minAlreadyTested = steps.find((s) => s.testingContext === minContextSize)
		let minFits = minAlreadyTested ? minAlreadyTested.fitsOnGpu : false

		if (!minAlreadyTested) {
			if (signal?.aborted) throw new Error("Autotune aborted")
			stepCount++
			onBeforeProbe?.(minContextSize, stepCount)
			const minRes = await probeFn(minContextSize)
			if (!minRes.success) {
				throw new Error(minRes.error || "Failed to communicate with Ollama")
			}
			minFits = minRes.fitsOnGpu
			const minProgress: AutotuneStepProgress = {
				step: stepCount,
				testingContext: minContextSize,
				fitsOnGpu: minFits,
				gpuPercent: minRes.gpuPercent,
				direction: "down",
				stepSize: 0,
			}
			steps.push(minProgress)
			onProgress?.(minProgress)
		}

		if (minFits) {
			bestFit = minContextSize
			let searchLow = minContextSize
			let searchHigh = currentContext

			while (searchHigh - searchLow >= minStepSize) {
				if (signal?.aborted) throw new Error("Autotune aborted")

				let mid = Math.round((searchLow + searchHigh) / 2)
				// Align to nearest 512
				mid = Math.round(mid / 512) * 512
				if (mid <= searchLow || mid >= searchHigh) break

				stepCount++
				onBeforeProbe?.(mid, stepCount)
				const res = await probeFn(mid)
				if (!res.success) {
					throw new Error(res.error || "Failed to communicate with Ollama")
				}

				const fits = res.fitsOnGpu
				if (fits) {
					bestFit = Math.max(bestFit, mid)
					searchLow = mid
				} else {
					searchHigh = mid
				}

				const progress: AutotuneStepProgress = {
					step: stepCount,
					testingContext: mid,
					fitsOnGpu: fits,
					gpuPercent: res.gpuPercent,
					direction: fits ? "up" : "down",
					stepSize: Math.floor((searchHigh - searchLow) / 2),
				}
				steps.push(progress)
				onProgress?.(progress)
			}
		}
	} else if (bestFit === 0 && !steps.some((s) => s.testingContext === minContextSize)) {
		// Probe minContextSize if not yet tested
		if (signal?.aborted) throw new Error("Autotune aborted")
		stepCount++
		onBeforeProbe?.(minContextSize, stepCount)
		const minRes = await probeFn(minContextSize)
		if (minRes.success && minRes.fitsOnGpu) {
			bestFit = minContextSize
			const minProgress: AutotuneStepProgress = {
				step: stepCount,
				testingContext: minContextSize,
				fitsOnGpu: true,
				gpuPercent: minRes.gpuPercent,
				direction: "down",
				stepSize: 0,
			}
			steps.push(minProgress)
			onProgress?.(minProgress)
		}
	}

	const achievedAllGpu = bestFit > 0
	const optimalContextSize = achievedAllGpu ? bestFit : minContextSize

	const message = achievedAllGpu
		? `Optimal context size: ${optimalContextSize.toLocaleString()} tokens fits 100% on GPU.`
		: `Model weights exceed available VRAM even at minimum context size of ${minContextSize}.`

	return {
		optimalContextSize,
		achievedAllGpu,
		steps,
		message,
	}
}

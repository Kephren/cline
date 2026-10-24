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
 * All context size increments and probes are aligned to 4K byte/token steps (multiples of minStepSize, default 4096).
 *
 * Algorithm:
 * 1. Probes initial target context size (aligned to 4K stepUnit, <= maxContextSize).
 * 2. If it fits and is at maxContextSize, optimal fit is achieved immediately.
 * 3. If it does not fit, tests minContextSize (default 4096) to verify GPU feasibility.
 * 4. Performs binary search in 4K (minStepSize) increments to find the maximum context
 *    size that fits 100% on the GPU without spilling into CPU RAM.
 * 5. Returns optimal context size guaranteed to have been tested and verified to fit on GPU.
 */
export async function runOllamaAutotune({
	initialContextSize,
	probeFn,
	onBeforeProbe,
	onProgress,
	initialAdjustment = 4096,
	maxContextSize,
	minContextSize = 4096,
	minStepSize = 4096,
	signal,
}: AutotuneOptions): Promise<AutotuneResult> {
	const stepUnit = Math.max(1, minStepSize)
	const steps: AutotuneStepProgress[] = []

	// Align minContextSize and target context size to stepUnit
	const alignedMin = Math.max(stepUnit, Math.floor(minContextSize / stepUnit) * stepUnit)
	let targetContext = Math.max(alignedMin, Math.floor(initialContextSize / stepUnit) * stepUnit)
	if (maxContextSize && maxContextSize > 0) {
		const alignedMax = Math.max(alignedMin, Math.floor(maxContextSize / stepUnit) * stepUnit)
		targetContext = Math.min(alignedMax, targetContext)
	}

	let bestFit = 0
	let stepCount = 0

	// Helper to probe a context size and record progress
	const probe = async (
		ctx: number,
		direction: "up" | "down",
		stepSize: number,
	): Promise<AutotuneProbeResult> => {
		if (signal?.aborted) throw new Error("Autotune aborted")
		stepCount++
		onBeforeProbe?.(ctx, stepCount)
		const res = await probeFn(ctx)
		if (signal?.aborted) throw new Error("Autotune aborted")
		if (!res.success) {
			throw new Error(res.error || "Failed to communicate with Ollama")
		}
		const progress: AutotuneStepProgress = {
			step: stepCount,
			testingContext: ctx,
			fitsOnGpu: res.fitsOnGpu,
			gpuPercent: res.gpuPercent,
			direction,
			stepSize,
		}
		steps.push(progress)
		onProgress?.(progress)
		return res
	}

	// Step 1: Initial sample at target position
	const initialRes = await probe(targetContext, "down", initialAdjustment)
	if (initialRes.fitsOnGpu) {
		bestFit = targetContext
		// If initial sample fits and is already at maxContextSize (native limit), we are done!
		if (!maxContextSize || targetContext >= maxContextSize) {
			return {
				optimalContextSize: bestFit,
				achievedAllGpu: true,
				steps,
				message: `Optimal context size: ${bestFit.toLocaleString()} tokens fits 100% on GPU.`,
			}
		}
		// If initialContext < maxContextSize, search upwards between targetContext and maxContextSize
		let searchLow = targetContext
		let searchHigh = Math.floor(maxContextSize / stepUnit) * stepUnit
		const maxRes = await probe(searchHigh, "up", searchHigh - searchLow)
		if (maxRes.fitsOnGpu) {
			bestFit = searchHigh
		} else {
			while (searchHigh - searchLow > stepUnit) {
				const numSteps = Math.floor((searchHigh - searchLow) / stepUnit)
				let mid = searchLow + Math.floor(numSteps / 2) * stepUnit
				if (mid <= searchLow) mid = searchLow + stepUnit
				if (mid >= searchHigh) break

				const midRes = await probe(mid, "up", stepUnit)
				if (midRes.fitsOnGpu) {
					bestFit = Math.max(bestFit, mid)
					searchLow = mid
				} else {
					searchHigh = mid
				}
			}
		}
	} else {
		// Initial sample exceeded GPU. Verify if alignedMin fits.
		let searchHigh = targetContext
		let searchLow = alignedMin
		if (searchHigh > alignedMin) {
			const minRes = await probe(alignedMin, "down", searchHigh - alignedMin)
			if (minRes.fitsOnGpu) {
				bestFit = alignedMin
				searchLow = alignedMin
				while (searchHigh - searchLow > stepUnit) {
					const numSteps = Math.floor((searchHigh - searchLow) / stepUnit)
					let mid = searchLow + Math.floor(numSteps / 2) * stepUnit
					if (mid <= searchLow) mid = searchLow + stepUnit
					if (mid >= searchHigh) break

					const midRes = await probe(mid, "up", stepUnit)
					if (midRes.fitsOnGpu) {
						bestFit = Math.max(bestFit, mid)
						searchLow = mid
					} else {
						searchHigh = mid
					}
				}
			}
		}
	}

	const achievedAllGpu = bestFit > 0
	const optimalContextSize = achievedAllGpu ? bestFit : alignedMin
	const message = achievedAllGpu
		? `Optimal context size: ${optimalContextSize.toLocaleString()} tokens fits 100% on GPU.`
		: `Model weights exceed available VRAM even at minimum context size of ${alignedMin}.`

	return {
		optimalContextSize,
		achievedAllGpu,
		steps,
		message,
	}
}

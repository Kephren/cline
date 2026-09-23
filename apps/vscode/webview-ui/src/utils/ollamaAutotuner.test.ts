import { describe, expect, it, vi } from "vitest"
import { type AutotuneProbeResult, type AutotuneStepProgress, runOllamaAutotune } from "./ollamaAutotuner"

describe("runOllamaAutotune", () => {
	it("starts by adjusting context size by 4028 downwards when initial size exceeds GPU", async () => {
		// GPU holds up to 10,000 tokens
		const maxGpuTokens = 10000
		const probeFn = vi.fn(async (ctx: number): Promise<AutotuneProbeResult> => {
			const fits = ctx <= maxGpuTokens
			return {
				success: true,
				fitsOnGpu: fits,
				gpuPercent: fits ? 100 : 75,
				size: 5000000000,
				sizeVram: fits ? 5000000000 : 3750000000,
			}
		})

		const progressUpdates: AutotuneStepProgress[] = []
		const beforeProbeCalls: { ctx: number; step: number }[] = []

		const result = await runOllamaAutotune({
			initialContextSize: 16384,
			probeFn,
			onBeforeProbe: (ctx, step) => beforeProbeCalls.push({ ctx, step }),
			onProgress: (p) => progressUpdates.push(p),
			minContextSize: 512,
			minStepSize: 512,
		})

		expect(result.achievedAllGpu).toBe(true)
		expect(result.optimalContextSize).toBeLessThanOrEqual(maxGpuTokens)

		// Step 1: Initial sample at 16384
		expect(beforeProbeCalls[0].ctx).toBe(16384)
		expect(progressUpdates[0].testingContext).toBe(16384)
		expect(progressUpdates[0].fitsOnGpu).toBe(false)
		expect(progressUpdates[0].direction).toBe("down")

		// Step 2: First adjustment is exactly 4028: 16384 - 4028 = 12356
		expect(beforeProbeCalls[1].ctx).toBe(12356)
		expect(progressUpdates[1].testingContext).toBe(12356)
		expect(progressUpdates[1].fitsOnGpu).toBe(false)
		expect(progressUpdates[1].stepSize).toBe(2014) // halved from 4028

		// Step 3: Halved adjustment by 2014: 12356 - 2014 = 10342
		expect(beforeProbeCalls[2].ctx).toBe(10342)
		expect(progressUpdates[2].testingContext).toBe(10342)
		expect(progressUpdates[2].fitsOnGpu).toBe(false)
		expect(progressUpdates[2].stepSize).toBe(1007) // halved from 2014

		// Step 4: Halved adjustment by 1007: 10342 - 1007 = 9335 (fits on GPU!)
		expect(beforeProbeCalls[3].ctx).toBe(9335)
		expect(progressUpdates[3].testingContext).toBe(9335)
		expect(progressUpdates[3].fitsOnGpu).toBe(true)

		// Optimal context found
		expect(result.optimalContextSize).toBe(9335)
	})

	it("starts by adjusting context size by 4028 upwards when initial size fits on GPU", async () => {
		// GPU holds up to 13,000 tokens
		const maxGpuTokens = 13000
		const probeFn = vi.fn(async (ctx: number): Promise<AutotuneProbeResult> => {
			const fits = ctx <= maxGpuTokens
			return {
				success: true,
				fitsOnGpu: fits,
				gpuPercent: fits ? 100 : 85,
			}
		})

		const progressUpdates: AutotuneStepProgress[] = []
		const result = await runOllamaAutotune({
			initialContextSize: 8192,
			probeFn,
			onProgress: (p) => progressUpdates.push(p),
			minContextSize: 512,
			minStepSize: 512,
		})

		expect(result.achievedAllGpu).toBe(true)
		// Step 1 was 8192 (fits)
		expect(progressUpdates[0].testingContext).toBe(8192)
		expect(progressUpdates[0].fitsOnGpu).toBe(true)
		expect(progressUpdates[0].direction).toBe("up")

		// Step 2 adjusted by +4028: 8192 + 4028 = 12220 (fits)
		expect(progressUpdates[1].testingContext).toBe(12220)
		expect(progressUpdates[1].fitsOnGpu).toBe(true)

		// Step 3 adjusted by +2014: 12220 + 2014 = 14234 (does not fit)
		expect(progressUpdates[2].testingContext).toBe(14234)
		expect(progressUpdates[2].fitsOnGpu).toBe(false)

		// Step 4 adjusted by -1007: 14234 - 1007 = 13227 (does not fit)
		expect(progressUpdates[3].testingContext).toBe(13227)
		expect(progressUpdates[3].fitsOnGpu).toBe(false)

		// Next delta is 503 (< 512), stops! Best fit was 12220
		expect(result.optimalContextSize).toBe(12220)
	})

	it("stops immediately at max context size when target fits 100% on GPU", async () => {
		// GPU holds up to 65536 tokens, but target context is 32768
		const maxGpuTokens = 65536
		const targetTokens = 32768
		const probeFn = vi.fn(async (ctx: number): Promise<AutotuneProbeResult> => {
			const fits = ctx <= maxGpuTokens
			return {
				success: true,
				fitsOnGpu: fits,
				gpuPercent: 100,
			}
		})

		const progressUpdates: AutotuneStepProgress[] = []
		const result = await runOllamaAutotune({
			initialContextSize: targetTokens,
			maxContextSize: targetTokens,
			probeFn,
			onProgress: (p) => progressUpdates.push(p),
		})

		expect(result.achievedAllGpu).toBe(true)
		expect(result.optimalContextSize).toBe(targetTokens)
		// Exactly 1 probe needed since target fits and satisfies goal
		expect(probeFn).toHaveBeenCalledTimes(1)
		expect(progressUpdates[0].testingContext).toBe(targetTokens)
	})

	it("throws error when probeFn reports failure so network errors are not swallowed", async () => {
		const probeFn = vi.fn(async (_ctx: number): Promise<AutotuneProbeResult> => {
			return {
				success: false,
				fitsOnGpu: false,
				gpuPercent: 0,
				error: "Failed to connect to Ollama at http://localhost:11434",
			}
		})

		await expect(
			runOllamaAutotune({
				initialContextSize: 4096,
				probeFn,
			}),
		).rejects.toThrow("Failed to connect to Ollama")
	})

	it("clamps to minimum context size of 512 if model cannot fit in VRAM", async () => {
		// Model does not fit even at 512
		const probeFn = vi.fn(async (_ctx: number): Promise<AutotuneProbeResult> => {
			return {
				success: true,
				fitsOnGpu: false,
				gpuPercent: 40,
			}
		})

		const result = await runOllamaAutotune({
			initialContextSize: 4096,
			probeFn,
			minContextSize: 512,
			minStepSize: 512,
		})

		expect(result.achievedAllGpu).toBe(false)
		expect(result.optimalContextSize).toBe(512)
		expect(result.message).toContain("minimum context size of 512")
	})

	it("respects abort signal when calibration is cancelled", async () => {
		const controller = new AbortController()
		let callCount = 0
		const probeFn = vi.fn(async (_ctx: number): Promise<AutotuneProbeResult> => {
			callCount++
			if (callCount === 2) {
				controller.abort()
			}
			return { success: true, fitsOnGpu: false, gpuPercent: 50 }
		})

		await expect(
			runOllamaAutotune({
				initialContextSize: 16384,
				probeFn,
				signal: controller.signal,
			}),
		).rejects.toThrow("Autotune aborted")
	})

	it("maximizes the largest context number below target threshold rather than falling back to 512", async () => {
		// Target context is 32,768, GPU holds up to 16,384 tokens
		const maxGpuTokens = 16384
		const probeFn = vi.fn(async (ctx: number): Promise<AutotuneProbeResult> => {
			const fits = ctx <= maxGpuTokens
			return {
				success: true,
				fitsOnGpu: fits,
				gpuPercent: fits ? 100 : 70,
			}
		})

		const result = await runOllamaAutotune({
			initialContextSize: 32768,
			maxContextSize: 32768,
			probeFn,
			minContextSize: 512,
			minStepSize: 512,
		})

		expect(result.achievedAllGpu).toBe(true)
		// Should NOT fall back to minimum 512! Must find maximum context that fits (<= 16384, >= 16000)
		expect(result.optimalContextSize).toBeGreaterThanOrEqual(16000)
		expect(result.optimalContextSize).toBeLessThanOrEqual(16384)
	})
})

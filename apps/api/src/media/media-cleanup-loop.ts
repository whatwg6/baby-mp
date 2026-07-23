const DEFAULT_MEDIA_CLEANUP_INTERVAL_MILLISECONDS = 60 * 60 * 1000

export interface MediaCleanupLoopOptions {
  signal: AbortSignal
  clock?: () => number
  intervalMilliseconds?: number
  sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>
  onSuccess?: (cleaned: number, at: Date) => void | Promise<void>
  onError?: (at: Date) => void | Promise<void>
}

function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve()
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', finish)
      resolve()
    }
    const timer = setTimeout(finish, milliseconds)
    signal.addEventListener('abort', finish, { once: true })
  })
}

export async function runMediaCleanupLoop(
  cleanup: () => Promise<number>,
  options: MediaCleanupLoopOptions,
): Promise<void> {
  const interval = options.intervalMilliseconds ?? DEFAULT_MEDIA_CLEANUP_INTERVAL_MILLISECONDS
  const clock = options.clock ?? Date.now
  const sleep = options.sleep ?? abortableDelay
  while (!options.signal.aborted) {
    let cleaned: number
    try {
      cleaned = await cleanup()
    } catch {
      try {
        await options.onError?.(new Date(clock()))
      } catch {
        // Heartbeat storage can fail with the same dependency outage. The
        // scheduler must keep retrying instead of terminating on telemetry loss.
      }
      if (!options.signal.aborted) await sleep(interval, options.signal)
      continue
    }
    try {
      await options.onSuccess?.(cleaned, new Date(clock()))
    } catch {
      // Cleanup succeeded. A telemetry write failure must not turn it into a
      // cleanup failure or stop future scheduled iterations.
    }
    if (!options.signal.aborted) await sleep(interval, options.signal)
  }
}

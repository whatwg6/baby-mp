import type { ExportWorker } from './exports.worker'

const DEFAULT_IDLE_DELAY_MILLISECONDS = 2_000
const DEFAULT_CLEANUP_INTERVAL_MILLISECONDS = 5 * 60 * 1000

type WorkerOperations = Pick<ExportWorker, 'processOnce' | 'cleanupExpired'>

export interface ExportWorkerLoopOptions {
  signal: AbortSignal
  clock?: () => number
  idleDelayMilliseconds?: number
  cleanupIntervalMilliseconds?: number
  sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>
  onIterationError?: () => void
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

export async function runContinuousExportWorker(
  worker: WorkerOperations,
  options: ExportWorkerLoopOptions,
): Promise<void> {
  const clock = options.clock ?? Date.now
  const sleep = options.sleep ?? abortableDelay
  const idleDelay = options.idleDelayMilliseconds ?? DEFAULT_IDLE_DELAY_MILLISECONDS
  const cleanupInterval = options.cleanupIntervalMilliseconds ?? DEFAULT_CLEANUP_INTERVAL_MILLISECONDS
  let nextCleanupAt = 0

  while (!options.signal.aborted) {
    let processed = false
    try {
      processed = await worker.processOnce()
      const now = clock()
      if (now >= nextCleanupAt) {
        await worker.cleanupExpired(new Date(now))
        nextCleanupAt = now + cleanupInterval
      }
    } catch {
      options.onIterationError?.()
    }
    if (!processed && !options.signal.aborted) {
      await sleep(idleDelay, options.signal)
    }
  }
}

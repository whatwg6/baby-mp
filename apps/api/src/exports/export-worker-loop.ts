import type { ExportWorker } from './exports.worker'

const DEFAULT_IDLE_DELAY_MILLISECONDS = 2_000
const DEFAULT_CLEANUP_INTERVAL_MILLISECONDS = 5 * 60 * 1000
const DEFAULT_HEARTBEAT_INTERVAL_MILLISECONDS = 15_000
const DEFAULT_MAX_ITERATION_MILLISECONDS = 2 * 60 * 60 * 1000

type WorkerOperations = Pick<ExportWorker, 'processOnce' | 'cleanupExpired'>

export interface ExportWorkerLoopOptions {
  signal: AbortSignal
  clock?: () => number
  idleDelayMilliseconds?: number
  cleanupIntervalMilliseconds?: number
  heartbeatIntervalMilliseconds?: number
  maxIterationMilliseconds?: number
  sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>
  onHeartbeat?: (at: Date) => void | Promise<void>
  onIterationSuccess?: (at: Date) => void | Promise<void>
  onIterationError?: (at: Date) => void | Promise<void>
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
  const heartbeatInterval = options.heartbeatIntervalMilliseconds ?? DEFAULT_HEARTBEAT_INTERVAL_MILLISECONDS
  const maxIteration = options.maxIterationMilliseconds ?? DEFAULT_MAX_ITERATION_MILLISECONDS
  let nextCleanupAt = 0
  let iterationStartedAt: number | undefined
  let iterationFailed = false
  let watchdogFailureReported = false
  let heartbeatWrite: Promise<void> | undefined
  const writeFailure = (at: Date) => {
    iterationFailed = true
    if (watchdogFailureReported || !options.onIterationError) return
    watchdogFailureReported = true
    void Promise.resolve(options.onIterationError(at)).catch(() => undefined)
  }
  const writeHeartbeat = () => {
    if (!options.onHeartbeat || heartbeatWrite || iterationFailed || options.signal.aborted) return
    const now = clock()
    if (iterationStartedAt !== undefined && now - iterationStartedAt > maxIteration) {
      writeFailure(new Date(now))
      return
    }
    const current = (async () => {
      try {
        await options.onHeartbeat?.(new Date(now))
      } catch {
        // A dependency outage can also prevent heartbeat persistence. Keep the
        // export loop alive; the stale timestamp will make health fail closed.
      }
    })()
    heartbeatWrite = current
    void current.then(() => {
      if (heartbeatWrite === current) heartbeatWrite = undefined
    })
  }
  writeHeartbeat()
  const heartbeatTimer = options.onHeartbeat
    ? setInterval(writeHeartbeat, heartbeatInterval)
    : undefined
  heartbeatTimer?.unref()
  const stopPeriodicHeartbeat = () => {
    if (heartbeatTimer) clearInterval(heartbeatTimer)
  }
  options.signal.addEventListener('abort', stopPeriodicHeartbeat, { once: true })

  try {
    while (!options.signal.aborted) {
      let processed = false
      iterationStartedAt = clock()
      watchdogFailureReported = false
      try {
        processed = await worker.processOnce()
        if (options.signal.aborted) break
        const now = clock()
        if (now >= nextCleanupAt) {
          await worker.cleanupExpired(new Date(now))
          nextCleanupAt = now + cleanupInterval
        }
        await options.onIterationSuccess?.(new Date(now))
        iterationFailed = false
      } catch {
        iterationFailed = true
        if (!watchdogFailureReported) {
          try {
            await options.onIterationError?.(new Date(clock()))
          } catch {
            // Heartbeat storage can fail with the same dependency outage. The
            // worker must keep retrying instead of terminating on telemetry loss.
          }
        }
      } finally {
        iterationStartedAt = undefined
      }
      if (!processed && !options.signal.aborted) {
        await sleep(idleDelay, options.signal)
      }
    }
  } finally {
    options.signal.removeEventListener('abort', stopPeriodicHeartbeat)
    stopPeriodicHeartbeat()
    await heartbeatWrite
  }
}

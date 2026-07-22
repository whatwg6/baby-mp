import { randomUUID } from 'node:crypto'
import { rename, writeFile } from 'node:fs/promises'

import { ConfigService } from '@nestjs/config'
import { NestFactory } from '@nestjs/core'

import type { Environment } from '../config/environment'
import { runContinuousExportWorker } from './export-worker-loop'
import { ExportWorker } from './exports.worker'
import { ExportsWorkerModule } from './exports-worker.module'

const healthFile = '/tmp/export-worker-health.json'
const temporaryHealthFile = `${healthFile}.${process.pid}.tmp`

function createHealthFileWriter(): (update: {
  lastSuccessAt?: string
  lastFailureAt?: string
}) => Promise<void> {
  const state: { lastSuccessAt?: string; lastFailureAt?: string } = {}
  let pending = Promise.resolve()
  return (update) => {
    Object.assign(state, update)
    const contents = `${JSON.stringify(state)}\n`
    pending = pending.catch(() => undefined).then(async () => {
      await writeFile(temporaryHealthFile, contents, { mode: 0o600 })
      await rename(temporaryHealthFile, healthFile)
    })
    return pending
  }
}

async function main(): Promise<void> {
  const modes = ['--cleanup', '--once'].filter((argument) => process.argv.includes(argument))
  if (modes.length > 1) throw new Error('Choose only one export worker mode')

  const abortController = new AbortController()
  const stop = () => abortController.abort()
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  const app = await NestFactory.createApplicationContext(ExportsWorkerModule, { logger: ['error', 'warn'] })
  try {
    const worker = app.get(ExportWorker)
    if (process.argv.includes('--cleanup')) {
      const count = await worker.cleanupExpired()
      process.stdout.write(`${JSON.stringify({ cleaned: count })}\n`)
      return
    }
    if (process.argv.includes('--once')) {
      const processed = await worker.processOnce()
      process.stdout.write(`${JSON.stringify({ processed })}\n`)
      return
    }

    const instanceId = randomUUID()
    const config = app.get(ConfigService<Environment, true>)
    const writeHealthFile = createHealthFileWriter()
    await worker.registerHeartbeat(instanceId)
    const markStopped = () => {
      void worker.stopHeartbeat(instanceId).catch(() => undefined)
    }
    abortController.signal.addEventListener('abort', markStopped, { once: true })
    try {
      await runContinuousExportWorker(worker, {
        signal: abortController.signal,
        maxIterationMilliseconds:
          config.get('EXPORT_WORKER_MAX_ITERATION_SECONDS', { infer: true }) * 1_000,
        // Liveness is independent of ordinary ZIP duration, but the loop
        // watchdog stops success heartbeats when one iteration exceeds the
        // configured hard ceiling. The local file keeps container probes
        // instance-specific when multiple workers share the same database.
        onHeartbeat: async (at) => {
          await worker.recordHeartbeatSuccess(instanceId, at)
          await writeHealthFile({ lastSuccessAt: at.toISOString() })
        },
        onIterationSuccess: async (at) => {
          await worker.recordHeartbeatSuccess(instanceId, at)
          await writeHealthFile({ lastSuccessAt: at.toISOString() })
        },
        onIterationError: async (at) => {
          process.stderr.write('export worker iteration failed; retrying\n')
          await writeHealthFile({ lastFailureAt: at.toISOString() })
          await worker.recordHeartbeatFailure(instanceId, at)
        },
      })
    } finally {
      abortController.signal.removeEventListener('abort', markStopped)
      await worker.stopHeartbeat(instanceId).catch(() => undefined)
    }
  } finally {
    process.removeListener('SIGINT', stop)
    process.removeListener('SIGTERM', stop)
    await app.close()
  }
}

void main().catch(() => {
  process.stderr.write('export worker failed to start\n')
  process.exitCode = 1
})

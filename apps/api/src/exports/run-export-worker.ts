import { NestFactory } from '@nestjs/core'

import { runContinuousExportWorker } from './export-worker-loop'
import { ExportWorker } from './exports.worker'
import { ExportsWorkerModule } from './exports-worker.module'

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

    await runContinuousExportWorker(worker, {
      signal: abortController.signal,
      onIterationError: () => {
        process.stderr.write('export worker iteration failed; retrying\n')
      },
    })
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

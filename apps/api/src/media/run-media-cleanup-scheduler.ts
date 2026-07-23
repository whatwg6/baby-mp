import { randomUUID } from 'node:crypto'

import { NestFactory } from '@nestjs/core'

import { AppModule } from '../app.module'
import { runMediaCleanupLoop } from './media-cleanup-loop'
import { MediaService } from './media.service'

const minimumIntervalSeconds = 5 * 60
const maximumIntervalSeconds = 24 * 60 * 60

function cleanupIntervalMilliseconds(): number {
  const value = process.env.MEDIA_CLEANUP_INTERVAL_SECONDS ?? '3600'
  if (!/^\d+$/.test(value)) throw new Error('MEDIA_CLEANUP_INTERVAL_SECONDS must be an integer')
  const seconds = Number(value)
  if (seconds < minimumIntervalSeconds || seconds > maximumIntervalSeconds) {
    throw new Error('MEDIA_CLEANUP_INTERVAL_SECONDS must be between 300 and 86400')
  }
  return seconds * 1_000
}

async function main(): Promise<void> {
  const intervalMilliseconds = cleanupIntervalMilliseconds()
  const abortController = new AbortController()
  const stop = () => abortController.abort()
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] })
  try {
    const media = app.get(MediaService)
    const instanceId = randomUUID()
    await media.registerCleanupHeartbeat(instanceId)
    try {
      await runMediaCleanupLoop(() => media.cleanupOrphans(), {
        signal: abortController.signal,
        intervalMilliseconds,
        onSuccess: async (cleaned, at) => {
          await media.recordCleanupHeartbeatSuccess(instanceId, at)
          process.stdout.write(`${JSON.stringify({ message: 'media_cleanup_completed', cleaned })}\n`)
        },
        onError: async (at) => {
          process.stderr.write('media cleanup iteration failed; retrying\n')
          await media.recordCleanupHeartbeatFailure(instanceId, at)
        },
      })
    } finally {
      await media.stopCleanupHeartbeat(instanceId).catch(() => undefined)
    }
  } finally {
    process.removeListener('SIGINT', stop)
    process.removeListener('SIGTERM', stop)
    await app.close()
  }
}

void main().catch(() => {
  process.stderr.write('media cleanup scheduler failed to start\n')
  process.exitCode = 1
})

import { describe, expect, it, vi } from 'vitest'

import { runMediaCleanupLoop } from '../src/media/media-cleanup-loop'
import { MediaService } from '../src/media/media.service'

describe('media cleanup scheduler loop', () => {
  it('runs immediately, waits the configured interval, and stops cleanly', async () => {
    const now = new Date('2026-07-22T12:00:00.000Z')
    const abortController = new AbortController()
    const cleanup = vi.fn()
      .mockResolvedValueOnce(2)
      .mockImplementationOnce(async () => {
        abortController.abort()
        return 0
      })
    const sleep = vi.fn(async () => undefined)
    const onSuccess = vi.fn()

    await runMediaCleanupLoop(cleanup, {
      signal: abortController.signal,
      clock: () => now.getTime(),
      intervalMilliseconds: 1234,
      sleep,
      onSuccess,
    })

    expect(cleanup).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledTimes(1)
    expect(sleep).toHaveBeenCalledWith(1234, abortController.signal)
    expect(onSuccess).toHaveBeenNthCalledWith(1, 2, now)
    expect(onSuccess).toHaveBeenNthCalledWith(2, 0, now)
  })

  it('reports a failed iteration without terminating the scheduler', async () => {
    const now = new Date('2026-07-22T12:00:00.000Z')
    const abortController = new AbortController()
    const cleanup = vi.fn()
      .mockRejectedValueOnce(new Error('storage detail that must not be logged'))
      .mockImplementationOnce(async () => {
        abortController.abort()
        return 1
      })
    const onError = vi.fn().mockRejectedValueOnce(new Error('heartbeat unavailable'))

    await runMediaCleanupLoop(cleanup, {
      signal: abortController.signal,
      clock: () => now.getTime(),
      sleep: async () => undefined,
      onError,
    })

    expect(cleanup).toHaveBeenCalledTimes(2)
    expect(onError).toHaveBeenCalledOnce()
    expect(onError).toHaveBeenCalledWith(now)
  })

  it('persists low-sensitivity lifecycle heartbeats for the cleanup instance', async () => {
    const now = new Date('2026-07-22T12:00:00.000Z')
    const instanceId = '11111111-1111-4111-8111-111111111111'
    const create = vi.fn(async () => ({}))
    const updateMany = vi.fn(async () => ({ count: 1 }))
    const media = new MediaService({
      workerHeartbeat: { create, updateMany },
    } as never, {} as never)

    await media.registerCleanupHeartbeat(instanceId, now)
    await media.recordCleanupHeartbeatSuccess(instanceId, now)
    await media.recordCleanupHeartbeatFailure(instanceId, now)
    await media.stopCleanupHeartbeat(instanceId, now)

    expect(create).toHaveBeenCalledWith({
      data: { instanceId, workerName: 'media-cleanup', startedAt: now },
    })
    expect(updateMany).toHaveBeenNthCalledWith(1, {
      where: { instanceId, workerName: 'media-cleanup', stoppedAt: null },
      data: { lastSuccessAt: now },
    })
    expect(updateMany).toHaveBeenNthCalledWith(2, {
      where: { instanceId, workerName: 'media-cleanup', stoppedAt: null },
      data: { lastFailureAt: now },
    })
    expect(updateMany).toHaveBeenNthCalledWith(3, {
      where: { instanceId, workerName: 'media-cleanup', stoppedAt: null },
      data: { stoppedAt: now },
    })
  })
})

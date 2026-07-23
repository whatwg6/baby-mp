import { createHash } from 'node:crypto'

import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  ListMultipartUploadsCommand,
  UploadPartCommand,
} from '@aws-sdk/client-s3'
import type { ConfigService } from '@nestjs/config'
import { describe, expect, it, vi } from 'vitest'

import type { Environment } from '../src/config/environment'
import { S3StorageService } from '../src/media/s3-storage.service'

function storageWith(send: (command: unknown) => Promise<unknown>): S3StorageService {
  const values: Record<string, unknown> = {
    S3_BUCKET: 'private-bucket',
    S3_ENDPOINT: 'http://127.0.0.1:9000',
    S3_REGION: 'local',
    S3_FORCE_PATH_STYLE: true,
    S3_ACCESS_KEY: 'local-access',
    S3_SECRET_KEY: 'local-secret',
  }
  const config = {
    get: (key: string) => values[key],
  } as ConfigService<Environment, true>
  const storage = new S3StorageService(config)
  const internal = storage as unknown as {
    client: { send(command: unknown): Promise<unknown> }
  }
  internal.client = { send }
  return storage
}

async function* chunks(values: readonly Uint8Array[]): AsyncGenerator<Uint8Array> {
  for (const value of values) yield value
}

describe('M6 S3 streaming export storage', () => {
  it('uploads bounded multipart chunks and returns the exact byte count and digest', async () => {
    const commands: unknown[] = []
    const send = vi.fn(async (command: unknown) => {
      commands.push(command)
      if (command instanceof CreateMultipartUploadCommand) return { UploadId: 'upload-1' }
      if (command instanceof UploadPartCommand) {
        return { ETag: `"part-${command.input.PartNumber}"` }
      }
      if (command instanceof CompleteMultipartUploadCommand) return {}
      throw new Error('unexpected command')
    })
    const first = Buffer.alloc(8 * 1024 * 1024, 0x61)
    const second = Buffer.from('tail')
    const storage = storageWith(send)
    const result = await storage.uploadMultipart(
      'exports/random.zip',
      'application/zip',
      chunks([first.subarray(0, 3), first.subarray(3), second]),
    )

    const parts = commands.filter((command): command is UploadPartCommand =>
      command instanceof UploadPartCommand)
    expect(parts).toHaveLength(2)
    expect(parts.map((part) => part.input.ContentLength)).toEqual([8 * 1024 * 1024, 4])
    expect(commands.at(-1)).toBeInstanceOf(CompleteMultipartUploadCommand)
    expect(result).toEqual({
      sizeBytes: first.byteLength + second.byteLength,
      sha256: createHash('sha256').update(first).update(second).digest('hex'),
    })
  })

  it('aborts the multipart upload when a part fails and preserves the original failure', async () => {
    const failure = new Error('temporary upload failure')
    const send = vi.fn(async (command: unknown) => {
      if (command instanceof CreateMultipartUploadCommand) return { UploadId: 'upload-2' }
      if (command instanceof UploadPartCommand) throw failure
      if (command instanceof AbortMultipartUploadCommand) return {}
      throw new Error('unexpected command')
    })
    const storage = storageWith(send)
    await expect(storage.uploadMultipart(
      'exports/random.zip',
      'application/zip',
      chunks([Buffer.from('archive')]),
    )).rejects.toBe(failure)
    expect(send.mock.calls.some(([command]) => command instanceof AbortMultipartUploadCommand))
      .toBe(true)
    expect(send.mock.calls.some(([command]) => command instanceof CompleteMultipartUploadCommand))
      .toBe(false)
  })

  it('aborts only stale multipart uploads under the export prefix', async () => {
    const old = new Date('2026-07-16T00:00:00.000Z')
    const recent = new Date('2026-07-18T00:00:00.000Z')
    const send = vi.fn(async (command: unknown) => {
      if (command instanceof ListMultipartUploadsCommand) {
        expect(command.input.Prefix).toBe('exports/')
        return {
          IsTruncated: false,
          Uploads: [
            { Key: 'exports/old.zip', UploadId: 'old', Initiated: old },
            { Key: 'exports/recent.zip', UploadId: 'recent', Initiated: recent },
          ],
        }
      }
      if (command instanceof AbortMultipartUploadCommand) return {}
      throw new Error('unexpected command')
    })
    const storage = storageWith(send)
    await expect(storage.abortStaleMultipartUploads(
      'exports/',
      new Date('2026-07-17T00:00:00.000Z'),
    )).resolves.toBe(1)
    const aborts = send.mock.calls
      .map(([command]) => command)
      .filter((command): command is AbortMultipartUploadCommand =>
        command instanceof AbortMultipartUploadCommand)
    expect(aborts).toHaveLength(1)
    expect(aborts[0]!.input).toMatchObject({ Key: 'exports/old.zip', UploadId: 'old' })
  })
})

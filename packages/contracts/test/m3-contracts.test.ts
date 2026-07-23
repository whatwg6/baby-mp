import { describe, expect, it } from 'vitest'

import {
  createMediaUploadInputSchema,
  createRecordInputSchema,
  timelineQuerySchema,
  updateRecordInputSchema,
} from '../src'

const mediaId = 'b1111111-1111-4111-8111-111111111111'

describe('M3 contracts', () => {
  it('enforces record type invariants and media limits', () => {
    expect(createRecordInputSchema.safeParse({
      type: 'note', content: '', occurredAt: '2026-07-17T08:00:00+08:00', mediaIds: [],
    }).success).toBe(false)
    expect(createRecordInputSchema.safeParse({
      type: 'measurement', occurredAt: '2026-07-17T08:00:00+08:00', mediaIds: [],
      measurement: { heightCm: null, weightKg: null },
    }).success).toBe(false)
    expect(createRecordInputSchema.safeParse({
      type: 'milestone', title: '第一次走路', occurredAt: '2026-07-17T08:00:00+08:00',
      mediaIds: Array.from({ length: 10 }, () => mediaId),
    }).success).toBe(false)
  })

  it('accepts valid create/update and bounded timeline input', () => {
    expect(createRecordInputSchema.safeParse({
      type: 'measurement', content: '体检', occurredAt: '2026-07-17T08:00:00+08:00',
      mediaIds: [], measurement: { heightCm: 70.2 },
    }).success).toBe(true)
    expect(updateRecordInputSchema.safeParse({ version: 1, mediaIds: [mediaId] }).success).toBe(true)
    expect(timelineQuerySchema.parse({ limit: '50' }).limit).toBe(50)
    expect(timelineQuerySchema.safeParse({ limit: 51 }).success).toBe(false)
  })

  it('allows only JPEG/PNG and enforces the 20 MiB server limit', () => {
    expect(createMediaUploadInputSchema.safeParse({
      fileName: 'photo.jpg', mimeType: 'image/jpeg', sizeBytes: 20 * 1024 * 1024,
    }).success).toBe(true)
    expect(createMediaUploadInputSchema.safeParse({
      fileName: 'photo.webp', mimeType: 'image/webp', sizeBytes: 10,
    }).success).toBe(false)
    expect(createMediaUploadInputSchema.safeParse({
      fileName: 'photo.png', mimeType: 'image/png', sizeBytes: 20 * 1024 * 1024 + 1,
    }).success).toBe(false)
  })
})

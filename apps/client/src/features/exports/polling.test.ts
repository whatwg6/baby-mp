import { describe, expect, it } from 'vitest'

import { exportPollDelay, MAX_EXPORT_AUTO_POLLS, MAX_EXPORT_POLL_DELAY_MS } from './polling'

describe('export polling policy', () => {
  it('backs off from two seconds and caps the interval', () => {
    expect([0, 1, 2, 3, 4, 20].map(exportPollDelay)).toEqual([
      2_000, 4_000, 8_000, 16_000, 30_000, 30_000,
    ])
    expect(MAX_EXPORT_AUTO_POLLS).toBe(30)
    expect(MAX_EXPORT_POLL_DELAY_MS).toBe(30_000)
  })
})

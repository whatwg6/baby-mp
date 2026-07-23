import { describe, expect, it } from 'vitest'

import { naturalDateInTimeZone } from '../src/common/time/natural-date'

describe('naturalDateInTimeZone', () => {
  it('uses the configured business date instead of the UTC calendar date', () => {
    const afterMidnightInShanghai = new Date('2026-07-16T16:30:00.000Z')
    expect(naturalDateInTimeZone(afterMidnightInShanghai, 'Asia/Shanghai')).toBe(
      '2026-07-17',
    )
  })
})

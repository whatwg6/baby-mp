import { describe, expect, it } from 'vitest'

import { resolveWeappBundleBudget } from './check-release-artifacts.mjs'

describe('WeChat release artifact budget configuration', () => {
  it('uses the canonical variable and keeps the legacy name compatible', () => {
    expect(resolveWeappBundleBudget({ WEAPP_BUNDLE_BUDGET_BYTES: '3000000' }))
      .toBe(3_000_000)
    expect(resolveWeappBundleBudget({ WEAPP_ARTIFACT_BUDGET_BYTES: '2500000' }))
      .toBe(2_500_000)
    expect(resolveWeappBundleBudget({
      WEAPP_BUNDLE_BUDGET_BYTES: '2097152',
      WEAPP_ARTIFACT_BUDGET_BYTES: '2097152',
    })).toBe(2_097_152)
  })

  it('fails closed when canonical and legacy values conflict', () => {
    expect(() => resolveWeappBundleBudget({
      WEAPP_BUNDLE_BUDGET_BYTES: '2097152',
      WEAPP_ARTIFACT_BUDGET_BYTES: '1048576',
    })).toThrow('冲突')
  })

  it.each(['0', '-1', '1.5', ' 2097152 ', 'unlimited', '9007199254740992'])(
    'rejects an unsafe budget value: %s',
    (value) => {
      expect(() => resolveWeappBundleBudget({ WEAPP_BUNDLE_BUDGET_BYTES: value }))
        .toThrow()
    },
  )
})

import { describe, expect, it } from 'vitest'

import { resolveClientOutputRoot } from './build-output'

describe('client build output isolation', () => {
  it('keeps H5 E2E artifacts separate from release artifacts', () => {
    expect(resolveClientOutputRoot('h5', true)).toBe('dist/h5-e2e')
    expect(resolveClientOutputRoot('h5', false)).toBe('dist/h5')
  })

  it('does not alter release or unsupported test targets', () => {
    expect(resolveClientOutputRoot('weapp', false)).toBe('dist/weapp')
    expect(resolveClientOutputRoot('weapp', true)).toBe('dist/weapp')
  })
})

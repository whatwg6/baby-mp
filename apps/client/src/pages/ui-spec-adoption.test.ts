import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

function pageSource(file: string) {
  return readFileSync(resolve(process.cwd(), `src/pages/${file}`), 'utf8')
}

describe('client UI specification adoption', () => {
  it('renders safe family avatars with fallbacks', () => {
    const members = pageSource('family/members.tsx')
    expect(members).toContain('member.user.avatarUrl')
    expect(members).toContain('family-avatar--fallback')

    const invite = pageSource('family/invite.tsx')
    expect(invite).toContain('preview.baby.avatarUrl')
    expect(invite).toContain('family-avatar--fallback')
  })

  it('renders record type selection as a dismissible bottom drawer', () => {
    const records = pageSource('records/edit.tsx')
    expect(records).toContain('record-type-selector__overlay')
    expect(records).toContain('record-type-selector__handle')
    expect(records).toContain('platform.navigateBack()')
  })
})

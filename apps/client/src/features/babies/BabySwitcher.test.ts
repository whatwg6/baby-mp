import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

describe('shared baby switcher adoption', () => {
  it('is reused by all three baby-scoped main pages', () => {
    for (const page of ['home', 'timeline', 'growth']) {
      const source = readFileSync(resolve(process.cwd(), `src/pages/${page}/index.tsx`), 'utf8')
      expect(source, page).toContain("import { BabySwitcher }")
      expect(source, page).toContain('<BabySwitcher')
    }
  })
})

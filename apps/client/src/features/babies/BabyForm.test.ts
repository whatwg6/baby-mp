import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

describe('baby form interaction safeguards', () => {
  it('guards both baby forms and wires first-error focus and scrolling', () => {
    const component = readFileSync(resolve(process.cwd(), 'src/features/babies/BabyForm.tsx'), 'utf8')
    expect(component).toContain('firstBabyFormErrorField')
    expect(component).toContain('platform.scrollToElement')
    expect(component).toContain("focus={focusedField === 'name'}")

    for (const page of ['create', 'edit']) {
      const source = readFileSync(resolve(process.cwd(), `src/pages/babies/${page}.tsx`), 'utf8')
      expect(source, page).toContain('useBabyFormGuard')
      expect(source, page).toContain('onDirtyChange={setDirty}')
      expect(source, page).toContain('releaseUnsavedGuard')
    }
  })
})

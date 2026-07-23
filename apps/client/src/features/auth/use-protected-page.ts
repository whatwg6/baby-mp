import { useEffect, useState } from 'react'

import { getBabyState, loadBabies } from '../babies/store'
import { requireSession } from './navigation'
import { getAuthState } from './store'
import { platform } from '../../platform'

export function useProtectedPage(loadBabyList = true) {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let active = true
    void (async () => {
      if (!await requireSession()) return
      if (loadBabyList && getBabyState().status === 'idle') await loadBabies()
      if (active) setReady(true)
    })().catch(() => {
      if (!active) return
      if (getAuthState().status !== 'authenticated') {
        void platform.reLaunch('/pages/auth/index')
        return
      }
      setReady(true)
    })
    return () => { active = false }
  }, [loadBabyList])
  return ready
}

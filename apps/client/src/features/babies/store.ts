import { useSyncExternalStore } from 'react'

import { platform } from '../../platform'
import { isResourceAccessError } from '../../services/api-error'
import { listBabies } from './api'
import type { Baby } from './types'

const CURRENT_BABY_KEY = 'baby-mp.current-baby-id.v1'

interface BabyState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  babies: Baby[]
  current?: Baby
  error?: string
}

let state: BabyState = { status: 'idle', babies: [] }
let contextGeneration = 0
let loadSequence = 0
const listeners = new Set<() => void>()

function publish(next: BabyState) {
  state = next
  listeners.forEach((listener) => listener())
}

export function getBabyState() { return state }
export function getBabyContext() {
  return { babyId: state.current?.id, generation: contextGeneration }
}
export function subscribeBabies(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener) }
export function useBabyState() { return useSyncExternalStore(subscribeBabies, getBabyState, getBabyState) }

export async function loadBabies(options: { hideCurrentWhileLoading?: boolean } = {}) {
  if (options.hideCurrentWhileLoading) {
    contextGeneration += 1
    publish({ status: 'loading', babies: [] })
  }
  const requestSequence = ++loadSequence
  const generationAtStart = contextGeneration
  publish({ ...state, status: 'loading', error: undefined })
  try {
    const [babies, storedId] = await Promise.all([
      listBabies(), platform.getStorage<string>(CURRENT_BABY_KEY),
    ])
    if (requestSequence !== loadSequence || generationAtStart !== contextGeneration) return babies
    const current = babies.find((baby) => baby.id === storedId) ?? babies[0]
    publish({ status: 'ready', babies, current })
    if (current) await platform.setStorage(CURRENT_BABY_KEY, current.id)
    else await platform.removeStorage(CURRENT_BABY_KEY).catch(() => undefined)
    return babies
  } catch (error) {
    if (requestSequence !== loadSequence || generationAtStart !== contextGeneration) return []
    publish({ ...state, status: 'error', error: error instanceof Error ? error.message : '宝宝档案加载失败' })
    throw error
  }
}

export async function selectBaby(id: string) {
  const current = state.babies.find((baby) => baby.id === id)
  if (!current) return
  contextGeneration += 1
  publish({ ...state, current })
  await platform.setStorage(CURRENT_BABY_KEY, id)
}

export async function addAndSelectBaby(baby: Baby) {
  contextGeneration += 1
  publish({ status: 'ready', babies: [...state.babies.filter((item) => item.id !== baby.id), baby], current: baby })
  await platform.setStorage(CURRENT_BABY_KEY, baby.id)
}

export async function removeBabyFromState(id: string) {
  const babies = state.babies.filter((baby) => baby.id !== id)
  const current = state.current?.id === id ? babies[0] : state.current
  contextGeneration += 1
  loadSequence += 1
  publish({ status: 'ready', babies, current })
  if (current) await platform.setStorage(CURRENT_BABY_KEY, current.id)
  else await platform.removeStorage(CURRENT_BABY_KEY).catch(() => undefined)
}

/**
 * Resource endpoints deliberately return 403/404 when current membership no
 * longer grants access. Remove the revoked baby synchronously, then reconcile
 * with the authoritative accessible-baby list. Other failures leave cached
 * context untouched so a temporary network outage does not destroy UI state.
 */
export async function refreshBabiesAfterAccessError(error: unknown, babyId?: string) {
  if (!isResourceAccessError(error)) return false

  if (babyId) {
    await removeBabyFromState(babyId).catch(() => undefined)
    await loadBabies().catch(() => undefined)
  } else {
    await loadBabies({ hideCurrentWhileLoading: true }).catch(() => undefined)
  }
  return true
}

export function clearBabies() {
  contextGeneration += 1
  loadSequence += 1
  void platform.removeStorage(CURRENT_BABY_KEY).catch(() => undefined)
  publish({ status: 'idle', babies: [] })
}

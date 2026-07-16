import { useSyncExternalStore } from 'react'

import { platform } from '../../platform'
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
const listeners = new Set<() => void>()

function publish(next: BabyState) {
  state = next
  listeners.forEach((listener) => listener())
}

export function getBabyState() { return state }
export function subscribeBabies(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener) }
export function useBabyState() { return useSyncExternalStore(subscribeBabies, getBabyState, getBabyState) }

export async function loadBabies() {
  publish({ ...state, status: 'loading', error: undefined })
  try {
    const [babies, storedId] = await Promise.all([
      listBabies(), platform.getStorage<string>(CURRENT_BABY_KEY),
    ])
    const current = babies.find((baby) => baby.id === storedId) ?? babies[0]
    if (current) await platform.setStorage(CURRENT_BABY_KEY, current.id)
    else await platform.removeStorage(CURRENT_BABY_KEY).catch(() => undefined)
    publish({ status: 'ready', babies, current })
    return babies
  } catch (error) {
    publish({ ...state, status: 'error', error: error instanceof Error ? error.message : '宝宝档案加载失败' })
    throw error
  }
}

export async function selectBaby(id: string) {
  const current = state.babies.find((baby) => baby.id === id)
  if (!current) return
  await platform.setStorage(CURRENT_BABY_KEY, id)
  publish({ ...state, current })
}

export async function addAndSelectBaby(baby: Baby) {
  await platform.setStorage(CURRENT_BABY_KEY, baby.id)
  publish({ status: 'ready', babies: [...state.babies.filter((item) => item.id !== baby.id), baby], current: baby })
}

export function clearBabies() {
  void platform.removeStorage(CURRENT_BABY_KEY).catch(() => undefined)
  publish({ status: 'idle', babies: [] })
}

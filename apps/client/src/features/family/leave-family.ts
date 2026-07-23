import { clearBabies, loadBabies } from '../babies/store'
import { leaveFamily } from './api'

export async function leaveFamilyAndRefresh(babyId: string, version: number) {
  await leaveFamily(babyId, version)
  clearBabies()
  try {
    return { remainingBabies: await loadBabies(), refreshFailed: false as const }
  } catch {
    return { remainingBabies: [], refreshFailed: true as const }
  }
}

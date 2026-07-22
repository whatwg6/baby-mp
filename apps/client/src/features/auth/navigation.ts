import { platform } from '../../platform'
import { resumePendingInvite } from '../family/invite-context'
import { loadBabies } from '../babies/store'
import { getAuthState, restoreAuth } from './store'

export async function resolveAuthenticatedLanding() {
  if (await resumePendingInvite()) return
  const babies = await loadBabies()
  if (babies.length === 0) await platform.reLaunch('/pages/babies/create')
  else await platform.switchTab('/pages/home/index')
}

export async function requireSession(): Promise<boolean> {
  const auth = getAuthState().status === 'restoring' ? await restoreAuth() : getAuthState()
  if (auth.status !== 'authenticated') {
    await platform.reLaunch('/pages/auth/index')
    return false
  }
  return true
}

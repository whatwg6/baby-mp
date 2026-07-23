import { platform } from '../../platform'
import { previewFamilyInvite } from './api'

const PENDING_INVITE_KEY = 'baby-mp.pending-family-invite.v1'
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/

export function isInviteToken(value: unknown): value is string {
  return typeof value === 'string' && TOKEN_PATTERN.test(value)
}

export async function rememberInviteToken(token: string): Promise<boolean> {
  if (!isInviteToken(token)) return false
  await platform.setStorage(PENDING_INVITE_KEY, token)
  return true
}

export async function pendingInviteToken(): Promise<string | undefined> {
  const token = await platform.getStorage<unknown>(PENDING_INVITE_KEY)
  if (!isInviteToken(token)) {
    await platform.removeStorage(PENDING_INVITE_KEY).catch(() => undefined)
    return undefined
  }
  return token
}

export async function clearPendingInvite(): Promise<void> {
  await platform.removeStorage(PENDING_INVITE_KEY).catch(() => undefined)
}

export interface PendingInviteLoginSummary {
  pending: true
  babyName?: string
  inviterName?: string
}

export async function loadPendingInviteLoginSummary(routeToken?: unknown): Promise<PendingInviteLoginSummary | undefined> {
  if (isInviteToken(routeToken)) await rememberInviteToken(routeToken)
  const token = await pendingInviteToken()
  if (!token) return undefined

  try {
    const preview = await previewFamilyInvite(token)
    if (preview.status !== 'pending') {
      await clearPendingInvite()
      return undefined
    }
    return {
      pending: true,
      babyName: preview.baby.name,
      inviterName: preview.inviter.displayName,
    }
  } catch {
    // A network or login failure must not consume the pending invite. The
    // login page can still show a generic token-free continuation notice and
    // retry the safe preview later.
    return { pending: true }
  }
}

export async function resumePendingInvite(): Promise<boolean> {
  if (!await pendingInviteToken()) return false
  await platform.reLaunch('/pages/family/invite?resume=1')
  return true
}

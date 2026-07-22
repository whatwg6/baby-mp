import { platform } from '../../platform'

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

export async function resumePendingInvite(): Promise<boolean> {
  if (!await pendingInviteToken()) return false
  await platform.reLaunch('/pages/family/invite?resume=1')
  return true
}

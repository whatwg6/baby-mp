import { authSessionSchema } from '@baby-mp/contracts'
import { useSyncExternalStore } from 'react'

import { platform } from '../../platform'
import { configureApiAuth } from '../../services/api-client'
import { clearBabies } from '../babies/store'
import { refreshSession, revokeSession } from './api'
import type { Session } from './types'

const SESSION_STORAGE_KEY = 'baby-mp.session.v1'

interface AuthState {
  status: 'restoring' | 'authenticated' | 'anonymous'
  session?: Session
}

let state: AuthState = { status: 'restoring' }
let restorePromise: Promise<AuthState> | undefined
let refreshPromise: Promise<string | undefined> | undefined
let authFailurePromise: Promise<void> | undefined
let authRevision = 0
let storageMutation = Promise.resolve()
const pendingAuthFailureRevisions: number[] = []
const listeners = new Set<() => void>()

function publish(next: AuthState) {
  state = next
  listeners.forEach((listener) => listener())
}

function isStoredSession(value: unknown): value is Session {
  return authSessionSchema.safeParse(value).success
}

function mutateSessionStorage(mutation: () => Promise<unknown>) {
  storageMutation = storageMutation.then(mutation, mutation).then(() => undefined)
  return storageMutation
}

export function subscribeAuth(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getAuthState() { return state }

export function useAuthState() {
  return useSyncExternalStore(subscribeAuth, getAuthState, getAuthState)
}

export async function restoreAuth(): Promise<AuthState> {
  if (state.status !== 'restoring') return state
  restorePromise ??= (async () => {
    const revisionAtStart = authRevision
    const stored = await platform.getStorage<unknown>(SESSION_STORAGE_KEY)
    if (authRevision !== revisionAtStart) return state
    if (!isStoredSession(stored) || Date.parse(stored.refreshTokenExpiresAt) <= Date.now()) {
      await clearSession()
      return state
    }
    authRevision += 1
    publish({ status: 'authenticated', session: stored })
    return state
  })()
  return restorePromise
}

export async function saveSession(session: Session) {
  const revision = ++authRevision
  if (state.session?.user.id && state.session.user.id !== session.user.id) clearBabies()
  await mutateSessionStorage(() => platform.setStorage(SESSION_STORAGE_KEY, session))
  if (authRevision !== revision) return
  publish({ status: 'authenticated', session })
}

export async function clearSession() {
  const revision = ++authRevision
  clearBabies()
  await mutateSessionStorage(() => platform.removeStorage(SESSION_STORAGE_KEY).catch(() => undefined))
  if (authRevision !== revision) return
  publish({ status: 'anonymous' })
}

export async function logout() {
  const refreshToken = state.session?.refreshToken
  try {
    if (refreshToken) await revokeSession(refreshToken)
  } finally {
    await clearSession()
  }
}

async function refreshAccessToken(): Promise<string | undefined> {
  const revisionAtStart = authRevision
  if (!state.session?.refreshToken) {
    pendingAuthFailureRevisions.push(revisionAtStart)
    return undefined
  }
  refreshPromise ??= (async () => {
    const sessionAtStart = state.session
    try {
      const next = await refreshSession(sessionAtStart!.refreshToken)
      if (state.session?.refreshToken !== sessionAtStart!.refreshToken) {
        return undefined
      }
      await saveSession(next)
      return next.accessToken
    } catch {
      return undefined
    } finally {
      refreshPromise = undefined
    }
  })()
  const token = await refreshPromise
  if (!token) pendingAuthFailureRevisions.push(revisionAtStart)
  return token
}

async function handleAuthFailure(): Promise<void> {
  const failureRevision = pendingAuthFailureRevisions.shift()
  if (failureRevision !== undefined && failureRevision !== authRevision) return
  if (state.status === 'anonymous') return
  authFailurePromise ??= (async () => {
    await clearSession()
    await platform.reLaunch('/pages/auth/index')
  })().finally(() => {
    authFailurePromise = undefined
  })
  return authFailurePromise
}

configureApiAuth({
  getAccessToken: () => state.session?.accessToken,
  refresh: refreshAccessToken,
  onAuthFailure: handleAuthFailure,
})

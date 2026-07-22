import { Button, Image, Text, View } from '@tarojs/components'
import { useEffect, useState } from 'react'

import { PageState } from '../../components'
import { getAuthState, restoreAuth } from '../../features/auth/store'
import { addAndSelectBaby, loadBabies, selectBaby } from '../../features/babies/store'
import {
  acceptFamilyInvite,
  clearPendingInvite,
  pendingInviteToken,
  previewFamilyInvite,
  rememberInviteToken,
  type InvitePreview,
} from '../../features/family'
import { platform } from '../../platform'
import { ApiClientError } from '../../services/api-error'

import './family.scss'

const roleText = { editor: '可查看并创建记录，只能修改自己创建的内容', viewer: '可查看宝宝档案与成长记录' }

export default function InvitePage() {
  const [token, setToken] = useState('')
  const [preview, setPreview] = useState<InvitePreview>()
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
  const [joining, setJoining] = useState(false)
  const [terminalError, setTerminalError] = useState(false)
  const [key] = useState(() => platform.createIdempotencyKey())

  const load = async () => {
    setStatus('loading'); setError(''); setTerminalError(false)
    const routeToken = platform.getRouteParams().token
    const candidate = routeToken && await rememberInviteToken(routeToken) ? routeToken : await pendingInviteToken()
    if (!candidate) { setError('邀请无效'); setStatus('error'); return }
    setToken(candidate)
    try {
      const next = await previewFamilyInvite(candidate)
      setPreview(next); setStatus('ready')
      if (next.status !== 'pending') await clearPendingInvite()
    } catch (reason) {
      if (reason instanceof ApiClientError && reason.code === 'INVITE_INVALID') { await clearPendingInvite(); setTerminalError(true) }
      setError(reason instanceof Error ? reason.message : '邀请无法预览'); setStatus('error')
    }
  }
  useEffect(() => { void load() }, [])

  const join = async () => {
    const auth = getAuthState().status === 'restoring' ? await restoreAuth() : getAuthState()
    if (auth.status !== 'authenticated') { await platform.reLaunch('/pages/auth/index'); return }
    setJoining(true)
    try {
      const accepted = await acceptFamilyInvite(token, key)
      await clearPendingInvite(); await addAndSelectBaby(accepted.baby)
      await platform.showToast('已加入家庭', 'success'); await platform.switchTab('/pages/home/index')
    } catch (reason) {
      if (reason instanceof ApiClientError && reason.code === 'ALREADY_A_MEMBER' && preview) {
        await clearPendingInvite()
        const babies = await loadBabies().catch(() => [])
        if (babies.some((baby) => baby.id === preview.baby.id)) await selectBaby(preview.baby.id)
        await platform.showToast('你已是家庭成员'); await platform.switchTab('/pages/home/index')
        return
      }
      if (reason instanceof ApiClientError && ['INVITE_EXPIRED', 'INVITE_REVOKED', 'INVITE_ALREADY_USED', 'INVITE_INVALID'].includes(reason.code)) {
        await clearPendingInvite(); setTerminalError(true)
      }
      setError(reason instanceof Error ? reason.message : '加入失败'); setStatus('error')
    }
    finally { setJoining(false) }
  }

  const leave = async () => {
    await clearPendingInvite()
    const auth = getAuthState().status === 'restoring' ? await restoreAuth() : getAuthState()
    await platform.reLaunch(auth.status === 'authenticated' ? '/pages/home/index' : '/pages/auth/index')
  }

  return <View className="page-shell">
    {status === 'loading' ? <PageState kind="loading" title="正在检查邀请" /> : null}
    {status === 'error' ? <PageState kind="error" title="无法加入家庭" description={error} actionLabel={terminalError ? '返回' : '重新检查'} onAction={() => void (terminalError ? leave() : load())} /> : null}
    {status === 'ready' && preview ? <View>
      <View className="page-heading family-invite-heading">
        {preview.baby.avatarUrl
          ? <Image className="family-invite-heading__avatar" src={preview.baby.avatarUrl} mode="aspectFill" />
          : <View className="family-invite-heading__avatar family-avatar--fallback">宝</View>}
        <Text className="page-title">加入 {preview.baby.name} 的家庭</Text><Text className="page-description">来自 {preview.inviter.displayName} 的邀请</Text>
      </View>
      <View className="surface-card family-invite-preview"><Text className="family-label">加入后的权限</Text><Text>{roleText[preview.role]}</Text><Text className="list-card__meta">邀请有效至 {new Date(preview.expiresAt).toLocaleString()}</Text></View>
      {preview.status === 'pending'
        ? <><Button className="primary-button" loading={joining} disabled={joining} onClick={() => void join()}>加入家庭</Button><Button className="secondary-button" onClick={() => void leave()}>暂不加入</Button></>
        : <PageState kind="empty" title={preview.status === 'accepted' ? '邀请已被使用' : preview.status === 'revoked' ? '邀请已撤销' : '邀请已过期'} actionLabel="返回" onAction={() => void leave()} />}
    </View> : null}
  </View>
}

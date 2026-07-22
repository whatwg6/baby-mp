import { Button, Image, Text, View } from '@tarojs/components'
import { useDidShow } from '@tarojs/taro'
import { useEffect, useMemo, useState } from 'react'

import { ConfirmDialog, PageState } from '../../components'
import { useProtectedPage } from '../../features/auth/use-protected-page'
import { loadBabies, useBabyState } from '../../features/babies/store'
import {
  listFamilyInvites,
  listFamilyMembers,
  leaveFamilyAndRefresh,
  removeFamilyMember,
  revokeFamilyInvite,
  updateFamilyMember,
  type FamilyInvite,
  type FamilyMember,
  type FamilyRole,
} from '../../features/family'
import { platform } from '../../platform'

import './family.scss'

const roleLabel: Record<FamilyRole, string> = { admin: '管理员', editor: '可编辑', viewer: '只读' }

export default function FamilyMembersPage() {
  const ready = useProtectedPage()
  const babies = useBabyState()
  const params = platform.getRouteParams()
  const babyId = params.babyId || babies.current?.id
  const baby = babies.babies.find((item) => item.id === babyId)
  const [members, setMembers] = useState<FamilyMember[]>([])
  const [invites, setInvites] = useState<FamilyInvite[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState('')
  const [leaving, setLeaving] = useState(false)
  const [removing, setRemoving] = useState<FamilyMember>()
  const isAdmin = baby?.role === 'admin'
  useDidShow(() => { if (ready) void loadBabies().catch(() => undefined) })

  const load = async () => {
    if (!babyId) return
    setStatus('loading'); setError('')
    try {
      const nextMembers = await listFamilyMembers(babyId)
      const nextInvites = isAdmin ? await listFamilyInvites(babyId) : []
      setMembers(nextMembers); setInvites(nextInvites); setStatus('ready')
    } catch (reason) {
      setMembers([]); setInvites([])
      setError(reason instanceof Error ? reason.message : '家庭成员加载失败'); setStatus('error')
      void loadBabies().catch(() => undefined)
    }
  }

  useEffect(() => { if (ready && babyId) void load() }, [ready, babyId, isAdmin])
  const adminCount = useMemo(() => members.filter((member) => member.role === 'admin').length, [members])

  const changeRole = async (member: FamilyMember, role: FamilyRole) => {
    if (!babyId || role === member.role) return
    setBusyId(member.id)
    try {
      const updated = await updateFamilyMember(babyId, member.id, member.version, role)
      setMembers((current) => current.map((item) => item.id === updated.id ? updated : item))
      await platform.showToast('权限已更新', 'success')
    } catch (reason) { await platform.showToast(reason instanceof Error ? reason.message : '更新失败') }
    finally { setBusyId('') }
  }

  const confirmRemove = async () => {
    if (!babyId || !removing) return
    setBusyId(removing.id)
    try {
      await removeFamilyMember(babyId, removing.id, removing.version)
      setMembers((current) => current.filter((item) => item.id !== removing.id))
      await platform.showToast('成员已移除', 'success')
    } catch (reason) { await platform.showToast(reason instanceof Error ? reason.message : '移除失败') }
    finally { setBusyId(''); setRemoving(undefined) }
  }

  const revoke = async (invite: FamilyInvite) => {
    if (!babyId) return
    const confirmed = await platform.showModal('撤销邀请', '撤销后该邀请将立即失效。', '撤销')
    if (!confirmed.confirm) return
    setBusyId(invite.id)
    try { await revokeFamilyInvite(babyId, invite.id); setInvites((current) => current.filter((item) => item.id !== invite.id)); await platform.showToast('邀请已撤销', 'success') }
    catch (reason) { await platform.showToast(reason instanceof Error ? reason.message : '撤销失败') }
    finally { setBusyId('') }
  }

  const currentMember = members.find((member) => member.isCurrentUser)
  const lastAdminCannotLeave = currentMember?.role === 'admin' && adminCount === 1

  const confirmLeave = async () => {
    if (!babyId || !currentMember) return
    setBusyId(currentMember.id)
    try {
      const result = await leaveFamilyAndRefresh(babyId, currentMember.version)
      setLeaving(false)
      await platform.showToast(result.refreshFailed ? '已退出家庭，请刷新宝宝列表' : '已退出家庭', result.refreshFailed ? 'none' : 'success')
      if (result.refreshFailed || result.remainingBabies.length > 0) await platform.switchTab('/pages/home/index')
      else await platform.reLaunch('/pages/babies/create')
    } catch (reason) {
      await platform.showToast(reason instanceof Error ? reason.message : '退出失败')
    } finally {
      setBusyId('')
    }
  }

  if (!ready || babies.status === 'idle' || babies.status === 'loading') return <View className="page-shell"><PageState kind="loading" title="正在确认家庭权限" /></View>
  if (!babyId) return <View className="page-shell"><PageState kind="empty" title="请先选择宝宝" /></View>
  if (!baby) return <View className="page-shell"><PageState kind="forbidden" title="宝宝空间不可用" description="你可能已退出家庭，或档案已被删除。" actionLabel="返回首页" onAction={() => void platform.switchTab('/pages/home/index')} /></View>
  return <View className="page-shell">
    <View className="page-heading"><Text className="page-title">家庭成员</Text><Text className="page-description">{baby?.name || '当前宝宝'} · 权限变更会立即在服务端生效。</Text></View>
    {isAdmin ? <Button className="primary-button family-primary" onClick={() => void platform.navigateTo(`/pages/family/invite-create?babyId=${babyId}`)}>邀请成员</Button> : null}
    {status === 'loading' ? <PageState kind="loading" /> : null}
    {status === 'error' ? <PageState kind="error" description={error} actionLabel="重新加载" onAction={() => void load()} /> : null}
    {status === 'ready' ? members.map((member) => <View className="surface-card family-member" key={member.id}>
      {member.user.avatarUrl
        ? <Image className="family-avatar" src={member.user.avatarUrl} mode="aspectFill" lazyLoad />
        : <View className="family-avatar family-avatar--fallback">家</View>}
      <View className="family-member__body"><Text className="list-card__title">{member.user.displayName}{member.isCurrentUser ? '（我）' : ''}</Text><Text className="list-card__meta">{roleLabel[member.role]} · 加入于 {member.joinedAt.slice(0, 10)}</Text></View>
      {isAdmin && !member.isCurrentUser ? <View className="family-actions">
        {(['admin', 'editor', 'viewer'] as FamilyRole[]).filter((role) => role !== member.role).map((role) => <Button key={role} size="mini" disabled={busyId === member.id || (member.role === 'admin' && adminCount === 1)} onClick={() => void changeRole(member, role)}>设为{roleLabel[role]}</Button>)}
        <Button size="mini" className="family-danger" disabled={busyId === member.id || (member.role === 'admin' && adminCount === 1)} onClick={() => setRemoving(member)}>移除</Button>
      </View> : null}
    </View>) : null}
    {isAdmin && invites.length > 0 ? <View className="family-section"><Text className="family-section__title">待接受邀请</Text>{invites.map((invite) => <View className="surface-card family-member" key={invite.id}><View><Text className="list-card__title">{roleLabel[invite.role]}</Text><Text className="list-card__meta">有效至 {new Date(invite.expiresAt).toLocaleString()}</Text></View><Button size="mini" loading={busyId === invite.id} onClick={() => void revoke(invite)}>撤销</Button></View>)}</View> : null}
    {status === 'ready' && currentMember ? <View className="family-leave">
      <Button className="danger-link" disabled={Boolean(busyId) || lastAdminCannotLeave} onClick={() => setLeaving(true)}>退出这个家庭</Button>
      {lastAdminCannotLeave ? <Text className="family-leave__hint">你是最后一位管理员。请先将另一位成员设为管理员，再退出家庭。</Text> : null}
    </View> : null}
    <ConfirmDialog open={Boolean(removing)} title="移除家庭成员" description="移除后，该成员会立即失去这个宝宝的全部访问权限。" confirmLabel="确认移除" cancelLabel="暂不移除" danger loading={Boolean(busyId)} onConfirm={() => void confirmRemove()} onCancel={() => setRemoving(undefined)} />
    <ConfirmDialog open={leaving} title="退出这个家庭" description={`退出后，你会立即失去“${baby?.name || '当前宝宝'}”的档案、成长记录和导出数据访问权限。此操作不会影响你加入的其他家庭。`} confirmLabel="确认退出" cancelLabel="暂不退出" danger loading={Boolean(busyId)} onConfirm={() => void confirmLeave()} onCancel={() => setLeaving(false)} />
  </View>
}

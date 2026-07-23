import { Button, Radio, RadioGroup, Text, View } from '@tarojs/components'
import { useDidShow } from '@tarojs/taro'
import { useState } from 'react'

import { PageState } from '../../components'
import { useProtectedPage } from '../../features/auth/use-protected-page'
import { loadBabies, useBabyState } from '../../features/babies/store'
import { createFamilyInvite, type CreatedFamilyInvite, type InviteRole } from '../../features/family'
import { platform, usePlatformShareMessage } from '../../platform'

import './family.scss'

export default function InviteCreatePage() {
  const ready = useProtectedPage()
  const babies = useBabyState()
  const babyId = platform.getRouteParams().babyId
  const baby = babies.babies.find((item) => item.id === babyId)
  const [role, setRole] = useState<InviteRole>('editor')
  const [loading, setLoading] = useState(false)
  const [invite, setInvite] = useState<CreatedFamilyInvite>()
  const [key, setKey] = useState(() => platform.createIdempotencyKey())
  usePlatformShareMessage(invite ? { title: '邀请你一起记录宝宝成长', path: invite.sharePath } : undefined)
  useDidShow(() => { if (ready) void loadBabies().catch(() => undefined) })

  const create = async () => {
    if (!babyId) return
    setLoading(true)
    try { const next = await createFamilyInvite(babyId, role, 24, key); setInvite(next); await platform.enableShareMenu() }
    catch (reason) { await platform.showToast(reason instanceof Error ? reason.message : '邀请创建失败') }
    finally { setLoading(false) }
  }

  if (!ready || babies.status === 'idle' || babies.status === 'loading') return <View className="page-shell"><PageState kind="loading" title="正在确认管理权限" /></View>
  if (!babyId || !baby || baby.role !== 'admin') return <View className="page-shell"><PageState kind="forbidden" title="只有当前管理员可以创建邀请" actionLabel="返回" onAction={() => void platform.navigateBack()} /></View>

  return <View className="page-shell"><View className="page-heading"><Text className="page-title">邀请家庭成员</Text><Text className="page-description">邀请有效期为 24 小时，只能成功加入一次。</Text></View>
    {!invite ? <View className="surface-card family-form"><Text className="family-label">加入后的权限</Text><RadioGroup onChange={(event) => { setRole(event.detail.value as InviteRole); setKey(platform.createIdempotencyKey()) }}>
      <View className="family-choice"><Radio value="editor" checked={role === 'editor'} color="#a95d42" /><View><Text className="list-card__title">可编辑</Text><Text className="list-card__meta">可查看并创建记录，只能修改自己创建的内容</Text></View></View>
      <View className="family-choice"><Radio value="viewer" checked={role === 'viewer'} color="#a95d42" /><View><Text className="list-card__title">只读</Text><Text className="list-card__meta">只能查看宝宝档案和成长记录</Text></View></View>
    </RadioGroup><Button className="primary-button" loading={loading} disabled={loading || !babyId} onClick={() => void create()}>生成邀请</Button></View>
      : <View className="surface-card family-result"><Text className="family-result__mark">✓</Text><Text className="page-title">邀请已生成</Text><Text className="page-description">点击右上角“…”发送给家庭成员。请勿把邀请内容公开转发。</Text><Button className="primary-button" openType="share">分享给家人</Button><Button className="secondary-button" onClick={() => void platform.navigateBack()}>返回成员列表</Button></View>}
  </View>
}

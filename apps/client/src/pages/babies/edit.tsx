import { Button, Text, View } from '@tarojs/components'
import { useDidShow } from '@tarojs/taro'
import { useCallback, useEffect, useRef, useState } from 'react'

import { BabyForm } from '../../features/babies/BabyForm'
import { deleteBaby, getBaby, updateBaby } from '../../features/babies/api'
import {
  loadBabies,
  refreshBabiesAfterAccessError,
  removeBabyFromState,
} from '../../features/babies/store'
import type { Baby, BabyInput } from '../../features/babies/types'
import type { MediaDraft } from '../../features/media/types'
import { uploadMediaDraft } from '../../features/media/upload'
import { useProtectedPage } from '../../features/auth/use-protected-page'
import { PageState } from '../../components/PageState'
import { platform } from '../../platform'
import { isResourceAccessError } from '../../services/api-error'

import './edit.scss'

export default function EditBabyPage() {
  const ready = useProtectedPage(false)
  const id = String(platform.getRouteParams().id ?? '')
  const [baby, setBaby] = useState<Baby>()
  const [babyAccessVerified, setBabyAccessVerified] = useState(false)
  const [loading, setLoading] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')
  const [avatar, setAvatar] = useState<MediaDraft>()
  const uploadController = useRef<AbortController>()
  const requestRevision = useRef(0)
  const mounted = useRef(true)

  useEffect(() => () => {
    mounted.current = false
    requestRevision.current += 1
    uploadController.current?.abort()
  }, [])

  const clearSensitiveBaby = useCallback(() => {
    requestRevision.current += 1
    uploadController.current?.abort()
    setBaby(undefined)
    setBabyAccessVerified(false)
    setAvatar(undefined)
  }, [])

  const refreshBaby = useCallback(async () => {
    if (!ready || !id) return
    const revision = ++requestRevision.current
    setBabyAccessVerified(false)
    setError('')
    try {
      const loaded = await getBaby(id)
      if (!mounted.current || revision !== requestRevision.current) return
      setBaby(loaded)
      setBabyAccessVerified(true)
      setError('')
    } catch (reason) {
      if (!mounted.current || revision !== requestRevision.current) return
      if (isResourceAccessError(reason)) clearSensitiveBaby()
      setError(reason instanceof Error ? reason.message : '加载失败')
      void refreshBabiesAfterAccessError(reason, id)
    }
  }, [clearSensitiveBaby, id, ready])

  useEffect(() => { void refreshBaby() }, [refreshBaby])
  useDidShow(() => { void refreshBaby() })

  const submit = async (input: BabyInput) => {
    if (!baby) return
    setLoading(true); setError('')
    try {
      let avatarMediaId: string | undefined
      if (avatar) {
        uploadController.current?.abort()
        const controller = new AbortController()
        uploadController.current = controller
        avatarMediaId = await uploadMediaDraft(
          baby.id,
          avatar,
          (patch) => setAvatar((current) => current ? { ...current, ...patch } : current),
          controller.signal,
        )
      }
      await updateBaby(baby.id, {
        ...input,
        version: baby.version,
        ...(avatarMediaId ? { avatarMediaId } : {}),
      })
      await loadBabies()
      await platform.showToast('宝宝档案已更新', 'success')
      await platform.navigateBack()
    } catch (reason) {
      if (isResourceAccessError(reason)) clearSensitiveBaby()
      setError(reason instanceof Error ? reason.message : '保存失败，请稍后重试')
      void refreshBabiesAfterAccessError(reason, baby.id)
    }
    finally { setLoading(false) }
  }

  const remove = async () => {
    if (!baby || deleting) return
    const confirmation = await platform.showModal(
      '申请删除宝宝档案？',
      '删除后所有家庭成员会立即失去访问权限，已有导出仅按原到期时间保留，后续将按隐私政策清理数据。此操作当前不可在应用内恢复。',
      '确认删除',
    )
    if (!confirmation.confirm) return
    setDeleting(true)
    setError('')
    try {
      await deleteBaby(baby.id)
      await removeBabyFromState(baby.id)
      await loadBabies().catch(() => undefined)
      await platform.showToast('宝宝档案已删除', 'success')
      await platform.switchTab('/pages/home/index')
    } catch (reason) {
      if (isResourceAccessError(reason)) clearSensitiveBaby()
      setError(reason instanceof Error ? reason.message : '删除失败，请稍后重试')
      void refreshBabiesAfterAccessError(reason, baby.id)
    } finally {
      setDeleting(false)
    }
  }

  if (error && !babyAccessVerified) return <View className="page-shell"><PageState kind="error" description={error} /></View>
  if (!baby || !babyAccessVerified) return <View className="page-shell"><PageState kind="loading" title="正在加载宝宝档案" /></View>
  if (baby.role !== 'admin') return <View className="page-shell"><PageState kind="forbidden" title="只有管理员可以编辑宝宝档案" /></View>

  return <View className="page-shell"><View className="page-heading"><Text className="page-title">编辑宝宝档案</Text></View>
    <BabyForm key={baby.version} submitLabel="保存修改" loading={loading || deleting} error={error}
      avatar={avatar} avatarUrl={baby.avatarUrl} onAvatarChange={setAvatar}
      initialValues={{ name: baby.name, gender: baby.gender, birthDate: baby.birthDate,
        birthTime: baby.birthTime ?? '', birthHeightCm: baby.birthHeightCm?.toString() ?? '',
        birthWeightKg: baby.birthWeightKg?.toString() ?? '' }} onSubmit={submit} />
    <View className="surface-card danger-zone">
      <Text className="section-title">删除宝宝档案</Text>
      <Text className="page-description">所有家庭成员将立即失去访问权限，数据将进入后续清理流程。</Text>
      <Button className="danger-button" loading={deleting} disabled={loading || deleting}
        onClick={() => void remove()}>申请删除</Button>
    </View>
  </View>
}

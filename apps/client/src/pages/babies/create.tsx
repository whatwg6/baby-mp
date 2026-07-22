import { Button, Text, View } from '@tarojs/components'
import { useEffect, useRef, useState } from 'react'

import { BabyForm } from '../../features/babies/BabyForm'
import { useBabyFormGuard } from '../../features/babies/use-baby-form-guard'
import { createBaby, getBaby, updateBaby } from '../../features/babies/api'
import { addAndSelectBaby } from '../../features/babies/store'
import type { BabyInput } from '../../features/babies/types'
import type { Baby } from '../../features/babies/types'
import type { MediaDraft } from '../../features/media/types'
import { uploadMediaDraft } from '../../features/media/upload'
import { useProtectedPage } from '../../features/auth/use-protected-page'
import { platform } from '../../platform'

export default function CreateBabyPage() {
  const ready = useProtectedPage(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [avatar, setAvatar] = useState<MediaDraft>()
  const [createdBaby, setCreatedBaby] = useState<Baby>()
  const [dirty, setDirty] = useState(false)
  const idempotencyKey = useRef(platform.createIdempotencyKey())
  const uploadController = useRef<AbortController>()
  const releaseUnsavedGuard = useBabyFormGuard(dirty)

  useEffect(() => () => uploadController.current?.abort(), [])

  const submit = async (input: BabyInput) => {
    setLoading(true); setError('')
    let babyWasCreated = Boolean(createdBaby)
    try {
      const baby = createdBaby
        ? await getBaby(createdBaby.id)
        : await createBaby(input, idempotencyKey.current)
      if (!createdBaby) {
        babyWasCreated = true
        setCreatedBaby(baby)
        await addAndSelectBaby(baby)
      }
      let completed = baby
      if (avatar) {
        uploadController.current?.abort()
        const controller = new AbortController()
        uploadController.current = controller
        const mediaId = await uploadMediaDraft(
          baby.id,
          avatar,
          (patch) => setAvatar((current) => current ? { ...current, ...patch } : current),
          controller.signal,
        )
        completed = await updateBaby(baby.id, { version: baby.version, avatarMediaId: mediaId })
      }
      await addAndSelectBaby(completed)
      await releaseUnsavedGuard()
      setDirty(false)
      await platform.showToast('宝宝档案已创建', 'success')
      await platform.switchTab('/pages/home/index')
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : '创建失败，请稍后重试'
      setError(babyWasCreated
        ? `宝宝档案已创建，但头像未更新：${message}。请点击“重试头像”。`
        : message)
    } finally { setLoading(false) }
  }

  const continueWithoutAvatar = async () => {
    if (!createdBaby || loading) return
    setLoading(true)
    try {
      await addAndSelectBaby(await getBaby(createdBaby.id))
      await releaseUnsavedGuard()
      setDirty(false)
      await platform.showToast('宝宝档案已创建，可稍后补充头像', 'success')
      await platform.switchTab('/pages/home/index')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '进入首页失败，请重试')
    } finally {
      setLoading(false)
    }
  }

  if (!ready) return <View className="page-shell"><Text>正在恢复会话…</Text></View>
  return <View className="page-shell"><View className="page-heading"><Text className="page-title">创建宝宝档案</Text>
    <Text className="page-description">先建立宝宝资料，就可以开始记录成长。</Text></View>
    <BabyForm submitLabel={createdBaby ? '重试头像' : '创建宝宝'} loading={loading} error={error}
      avatar={avatar} onAvatarChange={setAvatar} onDirtyChange={setDirty} onSubmit={submit} />
    {createdBaby ? <Button className="secondary-button" disabled={loading}
      onClick={() => void continueWithoutAvatar()}>暂不上传头像，进入首页</Button> : null}
  </View>
}

import { Text, View } from '@tarojs/components'
import { useRef, useState } from 'react'

import { BabyForm } from '../../features/babies/BabyForm'
import { createBaby } from '../../features/babies/api'
import { addAndSelectBaby } from '../../features/babies/store'
import type { BabyInput } from '../../features/babies/types'
import { useProtectedPage } from '../../features/auth/use-protected-page'
import { platform } from '../../platform'

export default function CreateBabyPage() {
  const ready = useProtectedPage(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const idempotencyKey = useRef(platform.createIdempotencyKey())

  const submit = async (input: BabyInput) => {
    setLoading(true); setError('')
    try {
      const baby = await createBaby(input, idempotencyKey.current)
      await addAndSelectBaby(baby)
      await platform.showToast('宝宝档案已创建', 'success')
      await platform.switchTab('/pages/home/index')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '创建失败，请稍后重试')
    } finally { setLoading(false) }
  }

  if (!ready) return <View className="page-shell"><Text>正在恢复会话…</Text></View>
  return <View className="page-shell"><View className="page-heading"><Text className="page-title">创建宝宝档案</Text>
    <Text className="page-description">先建立宝宝资料，就可以开始记录成长。</Text></View>
    <BabyForm submitLabel="创建宝宝" loading={loading} error={error} onSubmit={submit} /></View>
}

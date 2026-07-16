import { Text, View } from '@tarojs/components'
import { useEffect, useState } from 'react'

import { BabyForm } from '../../features/babies/BabyForm'
import { getBaby, updateBaby } from '../../features/babies/api'
import { loadBabies } from '../../features/babies/store'
import type { Baby, BabyInput } from '../../features/babies/types'
import { useProtectedPage } from '../../features/auth/use-protected-page'
import { PageState } from '../../components/PageState'
import { platform } from '../../platform'

export default function EditBabyPage() {
  const ready = useProtectedPage(false)
  const id = String(platform.getRouteParams().id ?? '')
  const [baby, setBaby] = useState<Baby>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!ready || !id) return
    void getBaby(id).then(setBaby).catch((reason) => setError(reason instanceof Error ? reason.message : '加载失败'))
  }, [id, ready])

  const submit = async (input: BabyInput) => {
    if (!baby) return
    setLoading(true); setError('')
    try {
      await updateBaby(baby.id, { ...input, version: baby.version })
      await loadBabies()
      await platform.showToast('宝宝档案已更新', 'success')
      await platform.navigateBack()
    } catch (reason) { setError(reason instanceof Error ? reason.message : '保存失败，请稍后重试') }
    finally { setLoading(false) }
  }

  if (error && !baby) return <View className="page-shell"><PageState kind="error" description={error} /></View>
  if (!baby) return <View className="page-shell"><PageState kind="loading" title="正在加载宝宝档案" /></View>
  if (baby.role !== 'admin') return <View className="page-shell"><PageState kind="forbidden" title="只有管理员可以编辑宝宝档案" /></View>

  return <View className="page-shell"><View className="page-heading"><Text className="page-title">编辑宝宝档案</Text></View>
    <BabyForm key={baby.version} submitLabel="保存修改" loading={loading} error={error}
      initialValues={{ name: baby.name, gender: baby.gender, birthDate: baby.birthDate,
        birthTime: baby.birthTime ?? '', birthHeightCm: baby.birthHeightCm?.toString() ?? '',
        birthWeightKg: baby.birthWeightKg?.toString() ?? '' }} onSubmit={submit} />
  </View>
}

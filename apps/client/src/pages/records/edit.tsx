import { Button, Input, Picker, Text, Textarea, View } from '@tarojs/components'
import { useEffect, useRef, useState } from 'react'

import { PageState } from '../../components/PageState'
import { useProtectedPage } from '../../features/auth/use-protected-page'
import { getBabyContext, useBabyState } from '../../features/babies/store'
import { MediaPicker } from '../../features/media/MediaPicker'
import type { MediaDraft } from '../../features/media/types'
import { uploadMediaDraft } from '../../features/media/upload'
import { createRecord, getRecord, updateRecord } from '../../features/records/api'
import type { GrowthRecord, RecordFormValues, RecordType } from '../../features/records/types'
import { toLocalDateTime, toRecordInput, validateRecordForm } from '../../features/records/validation'
import { platform } from '../../platform'

import './records.scss'

const typeOptions: Array<{ type: RecordType; title: string; description: string }> = [
  { type: 'note', title: '图文记录', description: '照片、文字和日常瞬间' },
  { type: 'measurement', title: '身高体重', description: '一次可填写一项或两项' },
  { type: 'milestone', title: '成长里程碑', description: '记录第一次和重要纪念日' },
]

function initialValues(type: RecordType): RecordFormValues {
  return { type, title: '', content: '', heightCm: '', weightKg: '', occurredAt: toLocalDateTime(new Date()) }
}

function draftsFromRecord(record: GrowthRecord): MediaDraft[] {
  return record.media.map((media) => ({
    localId: media.id,
    fileName: `photo-${media.sortOrder + 1}.jpg`,
    mimeType: media.mimeType,
    sizeBytes: media.sizeBytes,
    width: media.width ?? undefined,
    height: media.height ?? undefined,
    mediaId: media.id,
    accessUrl: media.accessUrl,
    state: 'ready',
    progress: 100,
  }))
}

export default function RecordEditPage() {
  const ready = useProtectedPage()
  const babyState = useBabyState()
  const params = platform.getRouteParams()
  const recordId = params.id
  const routeType = typeOptions.some((item) => item.type === params.type) ? params.type as RecordType : undefined
  const [record, setRecord] = useState<GrowthRecord>()
  const [values, setValues] = useState<RecordFormValues>(() => initialValues(routeType ?? 'note'))
  const [media, setMedia] = useState<MediaDraft[]>([])
  const [loading, setLoading] = useState(Boolean(recordId))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()
  const [dirty, setDirty] = useState(false)
  const idempotencyKey = useRef(platform.createIdempotencyKey())

  const babyId = record?.babyId ?? params.babyId ?? babyState.current?.id
  const baby = babyState.babies.find((item) => item.id === babyId)

  useEffect(() => {
    if (!recordId) return
    let active = true
    setLoading(true)
    getRecord(recordId).then((loaded) => {
      if (!active) return
      setRecord(loaded)
      setValues({
        type: loaded.type,
        title: loaded.title ?? '',
        content: loaded.content ?? '',
        heightCm: loaded.measurement?.heightCm?.toString() ?? '',
        weightKg: loaded.measurement?.weightKg?.toString() ?? '',
        occurredAt: toLocalDateTime(loaded.occurredAt),
      })
      setMedia(draftsFromRecord(loaded))
      setLoading(false)
    }).catch((cause) => {
      if (!active) return
      setError(cause instanceof Error ? cause.message : '记录加载失败')
      setLoading(false)
    })
    return () => { active = false }
  }, [recordId])

  const updateValue = <K extends keyof RecordFormValues>(key: K, value: RecordFormValues[K]) => {
    setDirty(true)
    setValues((current) => ({ ...current, [key]: value }))
  }

  const patchMedia = (localId: string, patch: Partial<MediaDraft>) => {
    setMedia((current) => current.map((item) => item.localId === localId ? { ...item, ...patch } : item))
  }

  const retryMedia = async (item: MediaDraft) => {
    if (!babyId) return
    try { await uploadMediaDraft(babyId, item, (patch) => patchMedia(item.localId, patch)) }
    catch { /* the item keeps its own retryable error */ }
  }

  const save = async () => {
    if (saving || !babyId) return
    const validationError = validateRecordForm(values, media.length, baby?.birthDate)
    if (validationError) { setError(validationError); return }
    setSaving(true)
    setError(undefined)
    const babyContext = getBabyContext()
    let leftPage = false
    try {
      if (babyContext.babyId !== babyId) {
        throw new Error('当前宝宝已切换，请返回后在新宝宝空间重新开始')
      }
      const mediaIds: string[] = []
      for (const item of media) {
        const mediaId = item.state === 'ready' && item.mediaId
          ? item.mediaId
          : await uploadMediaDraft(babyId, item, (patch) => patchMedia(item.localId, patch))
        mediaIds.push(mediaId)
      }
      const latestContext = getBabyContext()
      if (latestContext.babyId !== babyContext.babyId || latestContext.generation !== babyContext.generation) {
        throw new Error('当前宝宝已切换，请在新宝宝页面重新提交')
      }
      const input = toRecordInput(values, mediaIds)
      let saved: GrowthRecord
      if (record) {
        const { type, ...update } = input
        if (type !== record.type) throw new Error('记录类型不能修改')
        saved = await updateRecord(record.id, { ...update, version: record.version })
      } else {
        saved = await createRecord(babyId, input, idempotencyKey.current)
      }
      if (record) await platform.redirectTo(`/pages/records/detail?id=${saved.id}`)
      else if (params.source === 'timeline') await platform.switchTab('/pages/timeline/index')
      else if (params.source === 'home') await platform.switchTab('/pages/home/index')
      else await platform.redirectTo(`/pages/records/detail?id=${saved.id}`)
      leftPage = true
      await platform.showToast(record ? '记录已更新' : '记录已保存', 'success')
    } catch (cause) {
      if (!leftPage) setError(cause instanceof Error ? cause.message : '保存失败，请重试')
    } finally {
      if (!leftPage) setSaving(false)
    }
  }

  const cancel = async () => {
    if (!dirty) { await platform.navigateBack(); return }
    const result = await platform.showModal('放弃修改？', '尚未保存的文字和照片将会丢失。', '放弃修改', '继续编辑')
    if (result.confirm) await platform.navigateBack()
  }

  if (!ready || loading) return <View className="page-shell"><PageState kind="loading" title="正在准备记录" /></View>
  if (recordId && error && !record) return <View className="page-shell"><PageState kind="error" title="无法打开记录" description={error} actionLabel="返回" onAction={() => void platform.navigateBack()} /></View>
  if (!recordId && !routeType) return <View className="page-shell record-page"><View className="page-heading"><Text className="page-title">添加成长记录</Text><Text className="page-description">选择最适合这次成长瞬间的记录方式。</Text></View>
    {typeOptions.map((option) => <View className="record-type-option" key={option.type} onClick={() => {
      updateValue('type', option.type)
      void platform.redirectTo(`/pages/records/edit?type=${option.type}&babyId=${babyId ?? ''}&source=${params.source ?? ''}`)
    }}><View><Text className="record-type-option__title">{option.title}</Text><Text className="record-type-option__description">{option.description}</Text></View><Text>›</Text></View>)}
  </View>
  if (!babyId) return <View className="page-shell"><PageState kind="empty" title="先选择宝宝" description="成长记录必须保存在一个宝宝空间中。" actionLabel="返回首页" onAction={() => void platform.switchTab('/pages/home/index')} /></View>
  if (record && !record.permissions.canEdit) return <View className="page-shell"><PageState kind="forbidden" title="没有编辑权限" description="你可以继续查看这条记录。" actionLabel="返回详情" onAction={() => void platform.navigateBack()} /></View>

  const dateValue = values.occurredAt.slice(0, 10)
  const timeValue = values.occurredAt.slice(11, 16)
  return <View className="page-shell record-page">
    <View className="record-page__toolbar"><Button className="link-button" disabled={saving} onClick={() => void cancel()}>取消</Button><Text className="page-title">{record ? '编辑' : '新建'}{typeOptions.find((item) => item.type === values.type)?.title}</Text></View>

    {values.type === 'milestone' ? <View className="form-field"><Text className="form-label">里程碑标题 *</Text><Input className="form-input" maxlength={60} value={values.title} placeholder="例如：第一次独立行走" onInput={(event) => updateValue('title', event.detail.value)} /></View> : null}
    {values.type === 'measurement' ? <View className="measurement-grid">
      <View className="form-field"><Text className="form-label">身高（cm）</Text><Input className="form-input" type="digit" value={values.heightCm} placeholder="20–250" onInput={(event) => updateValue('heightCm', event.detail.value)} /></View>
      <View className="form-field"><Text className="form-label">体重（kg）</Text><Input className="form-input" type="digit" value={values.weightKg} placeholder="0.2–300" onInput={(event) => updateValue('weightKg', event.detail.value)} /></View>
    </View> : null}
    <View className="form-field"><Text className="form-label">{values.type === 'note' ? '正文' : values.type === 'measurement' ? '备注' : '描述'}</Text>
      <Textarea className="form-textarea" maxlength={values.type === 'measurement' ? 500 : 2000} value={values.content} placeholder={values.type === 'note' ? '写下这个成长瞬间…' : '补充一些细节（选填）'} onInput={(event) => updateValue('content', event.detail.value)} />
      <Text className="form-counter">{values.content.length}/{values.type === 'measurement' ? 500 : 2000}</Text>
    </View>
    <MediaPicker items={media} disabled={saving} onChange={(items) => { setDirty(true); setMedia(items) }} onRetry={(item) => void retryMedia(item)} />
    <View className="form-field"><Text className="form-label">发生时间 *</Text><View className="datetime-row">
      <Picker mode="date" value={dateValue} end={toLocalDateTime(new Date()).slice(0, 10)} onChange={(event) => updateValue('occurredAt', `${event.detail.value}T${timeValue}`)}><View className="form-input picker-value">{dateValue}</View></Picker>
      <Picker mode="time" value={timeValue} onChange={(event) => updateValue('occurredAt', `${dateValue}T${event.detail.value}`)}><View className="form-input picker-value">{timeValue}</View></Picker>
    </View></View>
    {values.type === 'measurement' ? <Text className="medical-note">成长数据仅用于家庭记录，不构成医疗建议。</Text> : null}
    {error ? <Text className="form-error">{error}</Text> : null}
    <Button className="primary-button record-page__save" loading={saving} disabled={saving} onClick={() => void save()}>{saving ? '正在保存…' : '保存记录'}</Button>
  </View>
}

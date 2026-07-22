import { Button, Input, Picker, Text, Textarea, View } from '@tarojs/components'
import { useDidHide, useDidShow, useUnload } from '@tarojs/taro'
import { useCallback, useEffect, useRef, useState } from 'react'

import { PageState } from '../../components/PageState'
import { useProtectedPage } from '../../features/auth/use-protected-page'
import {
  getBabyContext,
  loadBabies,
  refreshBabiesAfterAccessError,
  useBabyState,
} from '../../features/babies/store'
import { MediaPicker } from '../../features/media/MediaPicker'
import type { MediaDraft } from '../../features/media/types'
import { uploadMediaDraft } from '../../features/media/upload'
import { createRecord, getRecord, updateRecord } from '../../features/records/api'
import type { GrowthRecord, RecordFormValues, RecordType } from '../../features/records/types'
import {
  toLocalDateTime,
  toRecordInput,
  validateRecordFormIssue,
  type RecordValidationIssue,
} from '../../features/records/validation'
import { platform, type UnsavedNavigationGuard } from '../../platform'
import { isResourceAccessError } from '../../services/api-error'

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
  const [recordAccessVerified, setRecordAccessVerified] = useState(!recordId)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()
  const [validationIssue, setValidationIssue] = useState<RecordValidationIssue>()
  const [dirty, setDirty] = useState(false)
  const idempotencyKey = useRef(platform.createIdempotencyKey())
  const uploadControllers = useRef(new Map<string, AbortController>())
  const recordRef = useRef<GrowthRecord>()
  const recordRequestRevision = useRef(0)
  const mounted = useRef(true)
  const unsavedGuard = useRef<UnsavedNavigationGuard>()

  const babyId = record?.babyId ?? params.babyId ?? babyState.current?.id
  const baby = babyState.babies.find((item) => item.id === babyId)

  const abortUploads = useCallback(() => {
    uploadControllers.current.forEach((controller) => controller.abort())
    uploadControllers.current.clear()
  }, [])
  const disposeUploads = useCallback(() => {
    mounted.current = false
    abortUploads()
  }, [abortUploads])

  useDidHide(abortUploads)
  useUnload(disposeUploads)
  useEffect(() => disposeUploads, [disposeUploads])

  const confirmDiscard = useCallback(async () => {
    const result = await platform.showModal('放弃修改？', '尚未保存的文字和照片将会丢失。', '放弃修改', '继续编辑')
    return result.confirm
  }, [])

  useEffect(() => {
    if (!dirty) return
    const guard = platform.guardUnsavedChanges('尚未保存的文字和照片将会丢失。', confirmDiscard)
    unsavedGuard.current = guard
    return () => {
      if (unsavedGuard.current === guard) unsavedGuard.current = undefined
      guard.dispose()
    }
  }, [confirmDiscard, dirty])

  const clearSensitiveRecord = useCallback(() => {
    recordRequestRevision.current += 1
    abortUploads()
    void unsavedGuard.current?.release()
    unsavedGuard.current = undefined
    recordRef.current = undefined
    setRecord(undefined)
    setRecordAccessVerified(false)
    setValues(initialValues(routeType ?? 'note'))
    setMedia([])
    setValidationIssue(undefined)
    setDirty(false)
    setLoading(false)
  }, [abortUploads, routeType])

  const loadExistingRecord = useCallback(async (preserveDraft: boolean) => {
    if (!recordId) return
    const revision = ++recordRequestRevision.current
    setRecordAccessVerified(false)
    setError(undefined)
    if (!preserveDraft) setLoading(true)
    try {
      const loaded = await getRecord(recordId)
      if (!mounted.current || revision !== recordRequestRevision.current) return
      recordRef.current = loaded
      setRecord(loaded)
      setRecordAccessVerified(true)
      if (!preserveDraft) {
        setValues({
          type: loaded.type,
          title: loaded.title ?? '',
          content: loaded.content ?? '',
          heightCm: loaded.measurement?.heightCm?.toString() ?? '',
          weightKg: loaded.measurement?.weightKg?.toString() ?? '',
          occurredAt: toLocalDateTime(loaded.occurredAt),
        })
        setMedia(draftsFromRecord(loaded))
      }
      setError(undefined)
    } catch (cause) {
      if (!mounted.current || revision !== recordRequestRevision.current) return
      const affectedBabyId = recordRef.current?.babyId ?? params.babyId
      if (isResourceAccessError(cause)) clearSensitiveRecord()
      setError(cause instanceof Error ? cause.message : '记录加载失败')
      void refreshBabiesAfterAccessError(cause, affectedBabyId)
    } finally {
      if (mounted.current && revision === recordRequestRevision.current) setLoading(false)
    }
  }, [clearSensitiveRecord, params.babyId, recordId])

  useEffect(() => {
    if (!ready || !recordId) return
    void loadExistingRecord(false)
  }, [loadExistingRecord, ready, recordId])

  useDidShow(() => {
    if (!ready) return
    void loadBabies().catch(() => undefined)
    if (recordId) void loadExistingRecord(Boolean(record))
  })

  const updateValue = <K extends keyof RecordFormValues>(key: K, value: RecordFormValues[K]) => {
    setDirty(true)
    setValidationIssue((current) => current?.field === key ? undefined : current)
    setValues((current) => ({ ...current, [key]: value }))
  }

  const patchMedia = (localId: string, patch: Partial<MediaDraft>) => {
    if (!mounted.current) return
    setMedia((current) => current.map((item) => item.localId === localId ? { ...item, ...patch } : item))
  }

  const runUpload = async (item: MediaDraft) => {
    if (!babyId) throw new Error('请先选择宝宝')
    uploadControllers.current.get(item.localId)?.abort()
    const controller = new AbortController()
    uploadControllers.current.set(item.localId, controller)
    try {
      return await uploadMediaDraft(
        babyId,
        item,
        (patch) => patchMedia(item.localId, patch),
        controller.signal,
      )
    } finally {
      if (uploadControllers.current.get(item.localId) === controller) {
        uploadControllers.current.delete(item.localId)
      }
    }
  }

  const retryMedia = async (item: MediaDraft) => {
    if (!babyId) return
    try { await runUpload(item) }
    catch { /* the item keeps its own retryable error */ }
  }

  const replaceMedia = (items: MediaDraft[]) => {
    const nextIds = new Set(items.map((item) => item.localId))
    media.forEach((item) => {
      if (!nextIds.has(item.localId)) {
        uploadControllers.current.get(item.localId)?.abort()
        uploadControllers.current.delete(item.localId)
      }
    })
    setDirty(true)
    if (items.length > 0) setValidationIssue((current) =>
      current?.field === 'media' || current?.field === 'content' ? undefined : current)
    setMedia(items)
  }

  const save = async () => {
    if (saving || !babyId) return
    const nextValidationIssue = validateRecordFormIssue(
      values,
      media.length,
      baby?.birthDate,
      baby?.birthTime,
    )
    if (nextValidationIssue) {
      setValidationIssue(nextValidationIssue)
      setError(undefined)
      void platform.scrollToElement(`#record-field-${nextValidationIssue.field}`)
      return
    }
    setSaving(true)
    setValidationIssue(undefined)
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
          : await runUpload(item)
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
      await unsavedGuard.current?.release()
      unsavedGuard.current = undefined
      setDirty(false)
      await platform.showToast(record ? '记录已更新' : '记录已保存', 'success')
      if (record) await platform.redirectTo(`/pages/records/detail?id=${saved.id}`)
      else if (params.source === 'timeline') await platform.switchTab('/pages/timeline/index')
      else if (params.source === 'home') await platform.switchTab('/pages/home/index')
      else await platform.redirectTo(`/pages/records/detail?id=${saved.id}`)
      leftPage = true
    } catch (cause) {
      if (!leftPage) {
        if (isResourceAccessError(cause)) clearSensitiveRecord()
        setError(cause instanceof Error ? cause.message : '保存失败，请重试')
        void refreshBabiesAfterAccessError(cause, babyId)
      }
    } finally {
      if (!leftPage) setSaving(false)
    }
  }

  const cancel = async () => {
    if (!dirty) { await platform.navigateBack(); return }
    if (!await confirmDiscard()) return
    await unsavedGuard.current?.release()
    unsavedGuard.current = undefined
    setDirty(false)
    await platform.navigateBack()
  }

  if (!ready || loading || (recordId && !recordAccessVerified && !error) || babyState.status === 'idle' || babyState.status === 'loading') return <View className="page-shell"><PageState kind="loading" title="正在准备记录" /></View>
  if (babyState.status === 'error') return <View className="page-shell"><PageState kind="error" title="宝宝列表加载失败" description={babyState.error} actionLabel="重新加载" onAction={() => void loadBabies()} /></View>
  if (recordId && error && !recordAccessVerified) return <View className="page-shell"><PageState kind="error" title="无法打开记录" description={error} actionLabel="返回" onAction={() => void platform.navigateBack()} /></View>
  if (!babyId) return <View className="page-shell"><PageState kind="empty" title="先选择宝宝" description="成长记录必须保存在一个宝宝空间中。" actionLabel="返回首页" onAction={() => void platform.switchTab('/pages/home/index')} /></View>
  if (!record && babyState.status === 'ready' && !baby) return <View className="page-shell"><PageState kind="forbidden" title="宝宝空间不可用" description="你可能已退出家庭，或档案已被删除。" actionLabel="返回首页" onAction={() => void platform.switchTab('/pages/home/index')} /></View>
  if (!record && baby?.role === 'viewer') return <View className="page-shell"><PageState kind="forbidden" title="没有新建权限" description="只读成员可以查看成长记录，但不能新建内容。" actionLabel="返回时间轴" onAction={() => void platform.switchTab('/pages/timeline/index')} /></View>
  if (!recordId && !routeType) return <View className="record-type-selector__overlay" onClick={() => void platform.navigateBack()}>
    <View className="record-type-selector" onClick={(event) => event.stopPropagation()}>
      <View className="record-type-selector__handle" />
      <Text className="record-type-selector__title">添加成长记录</Text>
      <Text className="record-type-selector__description">选择最适合这次成长瞬间的记录方式。</Text>
      {typeOptions.map((option) => <View className="record-type-option" key={option.type} onClick={() => {
        void platform.redirectTo(`/pages/records/edit?type=${option.type}&babyId=${babyId ?? ''}&source=${params.source ?? ''}`)
      }}><View><Text className="record-type-option__title">{option.title}</Text><Text className="record-type-option__description">{option.description}</Text></View><Text>›</Text></View>)}
      <Button className="link-button record-type-selector__cancel" onClick={() => void platform.navigateBack()}>暂不添加</Button>
    </View>
  </View>
  if (record && !record.permissions.canEdit) return <View className="page-shell"><PageState kind="forbidden" title="没有编辑权限" description="你可以继续查看这条记录。" actionLabel="返回详情" onAction={() => void platform.navigateBack()} /></View>

  const dateValue = values.occurredAt.slice(0, 10)
  const timeValue = values.occurredAt.slice(11, 16)
  return <View className="page-shell record-page">
    <View className="record-page__toolbar"><Button className="link-button" disabled={saving} onClick={() => void cancel()}>取消</Button><Text className="page-title">{record ? '编辑' : '新建'}{typeOptions.find((item) => item.type === values.type)?.title}</Text></View>

    {values.type === 'milestone' ? <View className="form-field" id="record-field-title"><Text className="form-label">里程碑标题 *</Text><Input className="form-input" focus={validationIssue?.field === 'title'} maxlength={60} value={values.title} placeholder="例如：第一次独立行走" onInput={(event) => updateValue('title', event.detail.value)} />{validationIssue?.field === 'title' ? <Text className="form-field__error">{validationIssue.message}</Text> : null}</View> : null}
    {values.type === 'measurement' ? <View className="measurement-grid">
      <View className="form-field" id="record-field-heightCm"><Text className="form-label">身高（cm）</Text><Input className="form-input" focus={validationIssue?.field === 'heightCm'} type="digit" value={values.heightCm} placeholder="20–250" onInput={(event) => updateValue('heightCm', event.detail.value)} />{validationIssue?.field === 'heightCm' ? <Text className="form-field__error">{validationIssue.message}</Text> : null}</View>
      <View className="form-field" id="record-field-weightKg"><Text className="form-label">体重（kg）</Text><Input className="form-input" focus={validationIssue?.field === 'weightKg'} type="digit" value={values.weightKg} placeholder="0.2–300" onInput={(event) => updateValue('weightKg', event.detail.value)} />{validationIssue?.field === 'weightKg' ? <Text className="form-field__error">{validationIssue.message}</Text> : null}</View>
    </View> : null}
    <View className="form-field" id="record-field-content"><Text className="form-label">{values.type === 'note' ? '正文' : values.type === 'measurement' ? '备注' : '描述'}</Text>
      <Textarea className="form-textarea" focus={validationIssue?.field === 'content'} maxlength={values.type === 'measurement' ? 500 : 2000} value={values.content} placeholder={values.type === 'note' ? '写下这个成长瞬间…' : '补充一些细节（选填）'} onInput={(event) => updateValue('content', event.detail.value)} />
      <Text className="form-counter">{values.content.length}/{values.type === 'measurement' ? 500 : 2000}</Text>
      {validationIssue?.field === 'content' ? <Text className="form-field__error">{validationIssue.message}</Text> : null}
    </View>
    <View id="record-field-media"><MediaPicker items={media} disabled={saving} onChange={replaceMedia} onRetry={(item) => void retryMedia(item)} />{validationIssue?.field === 'media' ? <Text className="form-field__error">{validationIssue.message}</Text> : null}</View>
    <View className="form-field" id="record-field-occurredAt"><Text className="form-label">发生时间 *</Text><View className="datetime-row">
      <Picker mode="date" value={dateValue} end={toLocalDateTime(new Date()).slice(0, 10)} onChange={(event) => updateValue('occurredAt', `${event.detail.value}T${timeValue}`)}><View className="form-input picker-value">{dateValue}</View></Picker>
      <Picker mode="time" value={timeValue} onChange={(event) => updateValue('occurredAt', `${dateValue}T${event.detail.value}`)}><View className="form-input picker-value">{timeValue}</View></Picker>
    </View>{validationIssue?.field === 'occurredAt' ? <Text className="form-field__error">{validationIssue.message}</Text> : null}</View>
    {values.type === 'measurement' ? <Text className="medical-note">成长数据仅用于家庭记录，不构成医疗建议。</Text> : null}
    {error ? <Text className="form-error">{error}</Text> : null}
    <Button className="primary-button record-page__save" loading={saving} disabled={saving} onClick={() => void save()}>保存记录</Button>
  </View>
}

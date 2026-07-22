import { Button, Image, Text, View } from '@tarojs/components'
import { useDidShow } from '@tarojs/taro'
import { useCallback, useEffect, useRef, useState } from 'react'

import { ConfirmDialog } from '../../components/ConfirmDialog'
import { PageState } from '../../components/PageState'
import { useProtectedPage } from '../../features/auth/use-protected-page'
import { loadBabies } from '../../features/babies/store'
import { deleteRecord, getRecord } from '../../features/records/api'
import { formatOccurredAt } from '../../features/records/RecordCard'
import type { GrowthRecord } from '../../features/records/types'
import { platform } from '../../platform'
import { isResourceAccessError } from '../../services/api-error'

import './records.scss'

const typeLabels = { note: '图文记录', measurement: '测量记录', milestone: '成长里程碑' }

export default function RecordDetailPage() {
  const ready = useProtectedPage()
  const recordId = platform.getRouteParams().id
  const [record, setRecord] = useState<GrowthRecord>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [showRevision, setShowRevision] = useState(0)
  const requestRevision = useRef(0)

  useDidShow(() => setShowRevision((value) => value + 1))

  const load = useCallback(async () => {
    if (!recordId) { setError('记录地址无效'); setLoading(false); return }
    const revision = ++requestRevision.current
    setLoading(true)
    try {
      const data = await getRecord(recordId)
      if (revision !== requestRevision.current) return
      setRecord(data)
      setError(undefined)
    } catch (cause) {
      if (revision !== requestRevision.current) return
      setRecord(undefined)
      setError(cause instanceof Error ? cause.message : '记录加载失败')
      if (isResourceAccessError(cause)) void loadBabies().catch(() => undefined)
    } finally {
      if (revision === requestRevision.current) setLoading(false)
    }
  }, [recordId])

  useEffect(() => {
    void load()
    return () => { requestRevision.current += 1 }
  }, [load, showRevision])

  const remove = async () => {
    if (!record || deleting) return
    setDeleting(true)
    let leftPage = false
    try {
      await deleteRecord(record.id, record.version)
      await platform.switchTab('/pages/timeline/index')
      leftPage = true
      await platform.showToast('记录已删除', 'success')
    } catch (cause) {
      if (!leftPage) {
        setError(cause instanceof Error ? cause.message : '删除失败，请重试')
        setConfirmOpen(false)
        if (isResourceAccessError(cause)) {
          requestRevision.current += 1
          setRecord(undefined)
          void loadBabies().catch(() => undefined)
        }
      }
    } finally {
      if (!leftPage) setDeleting(false)
    }
  }

  if (!ready || loading) return <View className="page-shell"><PageState kind="loading" title="正在读取成长记录" /></View>
  if (!record) return <View className="page-shell"><PageState kind="error" title="记录不可用" description={error || '记录可能已删除，或你已没有查看权限。'} actionLabel="返回时间轴" onAction={() => void platform.switchTab('/pages/timeline/index')} /></View>

  return <View className="page-shell record-detail">
    <View className="record-detail__heading"><Text className={`record-card__type record-card__type--${record.type}`}>{typeLabels[record.type]}</Text><Text className="record-detail__time">{formatOccurredAt(record.occurredAt)}</Text></View>
    {record.title ? <Text className="record-detail__title">{record.title}</Text> : null}
    {record.measurement ? <View className="record-detail__measurement">
      {record.measurement.heightCm != null ? <View><Text className="record-detail__metric-value">{record.measurement.heightCm}</Text><Text className="record-detail__metric-unit"> cm 身高</Text></View> : null}
      {record.measurement.weightKg != null ? <View><Text className="record-detail__metric-value">{record.measurement.weightKg}</Text><Text className="record-detail__metric-unit"> kg 体重</Text></View> : null}
    </View> : null}
    {record.content ? <Text className="record-detail__content">{record.content}</Text> : null}
    {record.media.length ? <View className="record-detail__gallery">{record.media.map((media) => <Image key={media.id} className="record-detail__image" src={media.accessUrl || ''} mode="widthFix" onClick={() => {
      const urls = record.media.map((item) => item.accessUrl).filter((url): url is string => Boolean(url))
      if (media.accessUrl) void platform.previewImages(urls, media.accessUrl)
    }} />)}</View> : null}
    <View className="record-detail__meta"><Text>由 {record.createdBy.displayName || '家庭成员'} 记录</Text><Text>更新于 {formatOccurredAt(record.updatedAt)}</Text></View>
    {error ? <Text className="form-error">{error}</Text> : null}
    {record.permissions.canEdit || record.permissions.canDelete ? <View className="record-detail__actions">
      {record.permissions.canEdit ? <Button className="secondary-button" onClick={() => void platform.navigateTo(`/pages/records/edit?id=${record.id}`)}>编辑记录</Button> : null}
      {record.permissions.canDelete ? <Button className="danger-link" onClick={() => setConfirmOpen(true)}>删除记录</Button> : null}
    </View> : null}
    <ConfirmDialog open={confirmOpen} title="删除这条成长记录？" description="删除后将从时间轴和成长曲线中移除，且无法在客户端恢复。" confirmLabel="删除记录" cancelLabel="暂不删除" danger loading={deleting} onCancel={() => setConfirmOpen(false)} onConfirm={() => void remove()} />
  </View>
}

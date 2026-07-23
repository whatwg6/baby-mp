import { Button, Switch, Text, View } from '@tarojs/components'
import { useDidShow, useReachBottom } from '@tarojs/taro'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { ExportJob } from '@baby-mp/contracts'

import { ConfirmDialog } from '../../components/ConfirmDialog'
import { PageState } from '../../components/PageState'
import { useProtectedPage } from '../../features/auth/use-protected-page'
import { getBabyContext, loadBabies, useBabyState } from '../../features/babies/store'
import { createExport, listExports } from '../../features/exports/api'
import { ExportCard } from '../../features/exports/ExportCard'
import { platform } from '../../platform'

import './index.scss'

export default function ExportsPage() {
  const ready = useProtectedPage()
  const babyState = useBabyState()
  const routeBabyId = platform.getRouteParams().babyId
  const baby = routeBabyId
    ? babyState.babies.find((item) => item.id === routeBabyId)
    : babyState.current
  const [jobs, setJobs] = useState<ExportJob[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string>()
  const [includeMedia, setIncludeMedia] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [showRevision, setShowRevision] = useState(0)
  const requestRevision = useRef(0)
  const idempotencyKey = useRef(platform.createIdempotencyKey())
  const creatingLock = useRef(false)

  useDidShow(() => {
    setJobs([])
    setCursor(null)
    setError(undefined)
    setShowRevision((value) => value + 1)
  })

  const refresh = useCallback(async () => {
    if (!baby?.id || baby.role !== 'admin') return
    const revision = ++requestRevision.current
    const babyContext = getBabyContext()
    setLoading(true)
    setError(undefined)
    try {
      const page = await listExports(baby.id)
      const latest = getBabyContext()
      if (revision !== requestRevision.current || latest.generation !== babyContext.generation || latest.babyId !== babyContext.babyId) return
      setJobs(page.data)
      setCursor(page.meta.nextCursor)
    } catch (cause) {
      if (revision === requestRevision.current) {
        setJobs([])
        setError(cause instanceof Error ? cause.message : '导出任务加载失败')
      }
    } finally {
      if (revision === requestRevision.current) setLoading(false)
    }
  }, [baby?.id, baby?.role])

  const loadMore = useCallback(async () => {
    if (!baby?.id || !cursor || loading || loadingMore) return
    const revision = requestRevision.current
    const babyContext = getBabyContext()
    setLoadingMore(true)
    try {
      const page = await listExports(baby.id, { cursor })
      const latest = getBabyContext()
      if (revision !== requestRevision.current || latest.generation !== babyContext.generation || latest.babyId !== babyContext.babyId) return
      setJobs((current) => {
        const ids = new Set(current.map((job) => job.id))
        return [...current, ...page.data.filter((job) => !ids.has(job.id))]
      })
      setCursor(page.meta.nextCursor)
      setError(undefined)
    } catch (cause) {
      if (revision === requestRevision.current) setError(cause instanceof Error ? cause.message : '加载更多失败')
    } finally {
      if (revision === requestRevision.current) setLoadingMore(false)
    }
  }, [baby?.id, cursor, loading, loadingMore])

  useEffect(() => { setJobs([]); setCursor(null); void refresh() }, [refresh, showRevision])
  useReachBottom(() => { void loadMore() })

  const create = async () => {
    if (!baby?.id || baby.role !== 'admin' || creatingLock.current) return
    creatingLock.current = true
    setCreating(true)
    setError(undefined)
    try {
      const context = getBabyContext()
      const job = await createExport(baby.id, { includeMedia, format: 'zip' }, idempotencyKey.current)
      const latest = getBabyContext()
      if (latest.babyId !== context.babyId || latest.generation !== context.generation) throw new Error('当前宝宝已切换，新任务不会在此页面展示')
      idempotencyKey.current = platform.createIdempotencyKey()
      setConfirmOpen(false)
      await platform.navigateTo(`/pages/exports/detail?id=${job.id}`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '创建导出任务失败')
      setConfirmOpen(false)
    } finally {
      creatingLock.current = false
      setCreating(false)
    }
  }

  if (!ready || babyState.status === 'idle' || babyState.status === 'loading') return <View className="page-shell"><PageState kind="loading" title="正在准备数据导出" /></View>
  if (babyState.status === 'error') return <View className="page-shell"><PageState kind="error" description={babyState.error} actionLabel="重新加载" onAction={() => void loadBabies()} /></View>
  if (!baby) return <View className="page-shell"><PageState kind="empty" title="先选择宝宝" actionLabel="返回" onAction={() => void platform.navigateBack()} /></View>
  if (baby.role !== 'admin') return <View className="page-shell"><PageState kind="forbidden" title="仅管理员可以导出" description="导出包含宝宝档案和家庭成长记录，需要管理员权限。" actionLabel="返回" onAction={() => void platform.navigateBack()} /></View>

  return <View className="page-shell exports-page">
    <View className="page-heading"><Text className="page-title">数据导出</Text><Text className="page-description">为 {baby.name} 创建一份可长期保存的成长数据副本。</Text></View>
    <View className="export-create surface-card">
      <Text className="export-create__title">创建新的导出</Text>
      <Text className="export-create__fixed">始终包含：宝宝档案、图文记录、里程碑和测量数据（UTF-8 数据文件）</Text>
      <View className="export-create__option"><View><Text>同时包含照片</Text><Text>照片较多时，生成和下载会需要更长时间。</Text></View><Switch checked={includeMedia} disabled={creating} onChange={(event) => setIncludeMedia(event.detail.value)} /></View>
      <Button className="primary-button" disabled={creating} onClick={() => setConfirmOpen(true)}>创建 ZIP 导出</Button>
    </View>
    {error ? <View className="exports-inline-error"><Text>{error}</Text><Button size="mini" onClick={() => void refresh()}>重试</Button></View> : null}
    <View className="exports-heading"><Text>历史任务</Text></View>
    {loading && jobs.length === 0 ? <PageState kind="loading" title="正在加载导出任务" /> : null}
    {!loading && !error && jobs.length === 0 ? <PageState kind="empty" title="还没有导出任务" description="创建后可以在这里查看处理状态和下载期限。" /> : null}
    {jobs.map((job) => <ExportCard key={job.id} job={job} onClick={() => void platform.navigateTo(`/pages/exports/detail?id=${job.id}`)} />)}
    {loadingMore ? <Text className="exports-footer">正在加载更多…</Text> : null}
    {!cursor && jobs.length > 0 ? <Text className="exports-footer">已经看完了</Text> : null}
    <ConfirmDialog open={confirmOpen} title="创建数据导出？" description={`导出始终包含档案和全部成长数据，${includeMedia ? '并会打包照片。' : '本次不包含照片。'}生成完成后，下载地址仅在有限时间内有效。`} confirmLabel="创建导出" cancelLabel="暂不创建" loading={creating} onCancel={() => setConfirmOpen(false)} onConfirm={() => void create()} />
  </View>
}

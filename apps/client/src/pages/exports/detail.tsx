import { Button, Text, View } from '@tarojs/components'
import { useDidHide, useDidShow, useUnload } from '@tarojs/taro'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { ExportJob } from '@baby-mp/contracts'

import { ConfirmDialog } from '../../components/ConfirmDialog'
import { PageState } from '../../components/PageState'
import { useProtectedPage } from '../../features/auth/use-protected-page'
import { refreshBabiesAfterAccessError } from '../../features/babies/store'
import { createExport, getExport } from '../../features/exports/api'
import { downloadExportFile } from '../../features/exports/download'
import { exportPollDelay, MAX_EXPORT_AUTO_POLLS } from '../../features/exports/polling'
import { effectiveExportStatus, exportFailureMessage, exportStatusLabels, formatExportTime } from '../../features/exports/status'
import { platform } from '../../platform'
import { isResourceAccessError } from '../../services/api-error'

import './index.scss'

export default function ExportDetailPage() {
  const ready = useProtectedPage()
  const exportId = platform.getRouteParams().id
  const [job, setJob] = useState<ExportJob>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [downloading, setDownloading] = useState(false)
  const [recreating, setRecreating] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [showRevision, setShowRevision] = useState(0)
  const [pollAttempt, setPollAttempt] = useState(0)
  const jobRef = useRef<ExportJob>()
  const requestRevision = useRef(0)
  const requestController = useRef<AbortController>()
  const pollTimer = useRef<ReturnType<typeof setTimeout>>()
  const visible = useRef(true)
  const idempotencyKey = useRef(platform.createIdempotencyKey())
  const downloadingLock = useRef(false)
  const recreatingLock = useRef(false)

  const clearSensitiveJob = useCallback(() => {
    jobRef.current = undefined
    setJob(undefined)
    setConfirmOpen(false)
    if (pollTimer.current) clearTimeout(pollTimer.current)
    pollTimer.current = undefined
  }, [])

  useDidShow(() => {
    visible.current = true
    setPollAttempt(0)
    jobRef.current = undefined
    setJob(undefined)
    setLoading(true)
    setError(undefined)
    setShowRevision((value) => value + 1)
  })
  const stopPageWork = useCallback(() => {
    visible.current = false
    requestRevision.current += 1
    requestController.current?.abort()
    requestController.current = undefined
    if (pollTimer.current) clearTimeout(pollTimer.current)
    pollTimer.current = undefined
  }, [])
  useDidHide(stopPageWork)
  useUnload(stopPageWork)
  useEffect(() => stopPageWork, [stopPageWork])

  const load = useCallback(async (quiet = false) => {
    if (!exportId) { setError('导出任务地址无效'); setLoading(false); return }
    const revision = ++requestRevision.current
    requestController.current?.abort()
    const controller = new AbortController()
    requestController.current = controller
    if (!quiet) setLoading(true)
    try {
      const result = await getExport(exportId, controller.signal)
      if (!visible.current || revision !== requestRevision.current) return
      jobRef.current = result
      setJob(result)
      setError(undefined)
    } catch (cause) {
      if (controller.signal.aborted || !visible.current || revision !== requestRevision.current) return
      const affectedBabyId = jobRef.current?.babyId
      if (isResourceAccessError(cause)) clearSensitiveJob()
      else if (!quiet) setJob(undefined)
      setError(cause instanceof Error ? cause.message : '导出任务加载失败')
      void refreshBabiesAfterAccessError(cause, affectedBabyId)
    } finally {
      if (revision === requestRevision.current) setLoading(false)
      if (requestController.current === controller) requestController.current = undefined
    }
  }, [clearSensitiveJob, exportId])

  useEffect(() => { void load() }, [load, showRevision])
  useEffect(() => {
    if (!job || !['pending', 'processing'].includes(job.status)) return
    if (pollAttempt >= MAX_EXPORT_AUTO_POLLS) return
    pollTimer.current = setTimeout(() => {
      pollTimer.current = undefined
      if (!visible.current) return
      void load(true).finally(() => setPollAttempt((value) => value + 1))
    }, exportPollDelay(pollAttempt))
    return () => {
      if (pollTimer.current) clearTimeout(pollTimer.current)
      pollTimer.current = undefined
    }
  }, [job, load, pollAttempt])

  const download = async () => {
    if (!job || downloadingLock.current) return
    downloadingLock.current = true
    setDownloading(true)
    setError(undefined)
    try {
      await downloadExportFile(job.id)
      await platform.showToast('下载已开始', 'success')
    } catch (cause) {
      if (isResourceAccessError(cause)) clearSensitiveJob()
      setError(cause instanceof Error ? cause.message : '下载失败，请重试')
      void refreshBabiesAfterAccessError(cause, job.babyId)
    } finally {
      downloadingLock.current = false
      setDownloading(false)
    }
  }

  const recreate = async () => {
    if (!job || recreatingLock.current) return
    recreatingLock.current = true
    setRecreating(true)
    setError(undefined)
    try {
      const created = await createExport(job.babyId, {
        includeMedia: job.includeMedia,
        format: 'zip',
      }, idempotencyKey.current)
      idempotencyKey.current = platform.createIdempotencyKey()
      setConfirmOpen(false)
      await platform.redirectTo(`/pages/exports/detail?id=${created.id}`)
    } catch (cause) {
      if (isResourceAccessError(cause)) clearSensitiveJob()
      setError(cause instanceof Error ? cause.message : '重新创建导出失败')
      void refreshBabiesAfterAccessError(cause, job.babyId)
      setConfirmOpen(false)
    } finally {
      recreatingLock.current = false
      setRecreating(false)
    }
  }

  if (!ready || loading) return <View className="page-shell"><PageState kind="loading" title="正在读取导出任务" /></View>
  if (!job) return <View className="page-shell"><PageState kind="error" title="导出任务不可用" description={error || '任务不存在，或你已没有管理员权限。'} actionLabel="返回" onAction={() => void platform.navigateBack()} /></View>

  const status = effectiveExportStatus(job)
  return <View className="page-shell export-detail">
    <View className={`export-detail__status export-detail__status--${status}`}><Text className="export-detail__status-label">{exportStatusLabels[status]}</Text><Text>{status === 'pending' ? '任务正在排队。' : status === 'processing' ? '正在整理档案、记录和照片。' : status === 'completed' ? '导出包已准备好，请在有效期内下载。' : status === 'failed' ? exportFailureMessage(job.errorCode) : '旧下载地址已失效，请重新创建导出。'}</Text></View>
    <View className="export-detail__summary surface-card">
      <View><Text>文件格式</Text><Text>ZIP</Text></View>
      <View><Text>数据范围</Text><Text>档案与全部成长记录</Text></View>
      <View><Text>照片</Text><Text>{job.includeMedia ? '包含' : '不包含'}</Text></View>
      <View><Text>创建时间</Text><Text>{formatExportTime(job.createdAt)}</Text></View>
      {job.completedAt ? <View><Text>完成时间</Text><Text>{formatExportTime(job.completedAt)}</Text></View> : null}
      {status === 'completed' ? <View><Text>下载有效期</Text><Text>{formatExportTime(job.expiresAt)}</Text></View> : null}
    </View>
    {status === 'pending' || status === 'processing' ? <Text className="export-detail__polling">页面会自动刷新处理状态，离开后也不会中断任务。</Text> : null}
    {(status === 'pending' || status === 'processing') && pollAttempt >= MAX_EXPORT_AUTO_POLLS ? <View className="exports-inline-error"><Text>已暂停自动刷新，任务仍会在后台继续。</Text><Button size="mini" onClick={() => { setPollAttempt(0); void load(true) }}>继续刷新</Button></View> : null}
    {status === 'completed' ? <Button className="primary-button" loading={downloading} disabled={downloading} onClick={() => void download()}>获取下载地址并下载</Button> : null}
    {status === 'failed' || status === 'expired' ? <Button className="primary-button" disabled={recreating} onClick={() => setConfirmOpen(true)}>按相同选项重新导出</Button> : null}
    {error ? <Text className="form-error">{error}</Text> : null}
    <Text className="export-detail__privacy">为保护隐私，任务详情不保存或展示下载地址。每次点击下载都会单独获取一个短时有效地址。</Text>
    <ConfirmDialog open={confirmOpen} title="重新创建导出？" description={`将按相同范围创建新任务，${job.includeMedia ? '包含照片。' : '不包含照片。'}旧任务不会被复用。`} confirmLabel="重新导出" cancelLabel="暂不创建" loading={recreating} onCancel={() => setConfirmOpen(false)} onConfirm={() => void recreate()} />
  </View>
}

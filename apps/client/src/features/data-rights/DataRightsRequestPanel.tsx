import { Button, Switch, Text, View } from '@tarojs/components'
import { useDidShow } from '@tarojs/taro'
import { useCallback, useEffect, useRef, useState } from 'react'

import type {
  DataRightsRequest,
  DataRightsRequestType,
} from '@baby-mp/contracts'

import { ConfirmDialog } from '../../components/ConfirmDialog'
import { PageState } from '../../components/PageState'
import { platform } from '../../platform'
import { useAuthState } from '../auth/store'
import {
  loadBabies,
  refreshBabiesAfterAccessError,
  useBabyState,
} from '../babies/store'
import { isResourceAccessError } from '../../services/api-error'
import {
  cancelDataRightsRequest,
  createDataRightsRequest,
  listDataRightsRequests,
} from './api'
import {
  dataRightsConfirmation,
  dataRightsStatusLabel,
  dataRightsTypeLabel,
} from './status'

import './data-rights-request-panel.scss'

const REQUEST_TYPES: Array<{
  type: DataRightsRequestType
  description: string
}> = [
  {
    type: 'data_access',
    description: '申请人工核验并提供依法可提供的数据副本或处理说明。',
  },
  {
    type: 'correction',
    description: '申请更正无法在现有档案或记录编辑功能中完成的数据。',
  },
  {
    type: 'account_deletion',
    description: '申请注销账号或解除平台身份关联；不会在提交后立即删除。',
  },
]

export function DataRightsRequestPanel() {
  const auth = useAuthState()
  const babyState = useBabyState()
  const [type, setType] = useState<DataRightsRequestType>('data_access')
  const [babyScoped, setBabyScoped] = useState(false)
  const [requests, setRequests] = useState<DataRightsRequest[]>([])
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string>()
  const [confirmSubmit, setConfirmSubmit] = useState(false)
  const [cancelTarget, setCancelTarget] = useState<DataRightsRequest>()
  const [babyAccessVerified, setBabyAccessVerified] = useState(false)
  const submitLock = useRef(false)
  const cancelLock = useRef(false)
  const babyRefreshRevision = useRef(0)
  const currentBaby = babyAccessVerified ? babyState.current : undefined

  const refreshBabyAccess = useCallback(async () => {
    if (auth.status !== 'authenticated') {
      setBabyAccessVerified(false)
      return
    }
    const revision = ++babyRefreshRevision.current
    setBabyAccessVerified(false)
    try {
      await loadBabies()
      if (revision === babyRefreshRevision.current) setBabyAccessVerified(true)
    } catch {
      // Keep the last store value for transient recovery, but never render its
      // name on this privacy-sensitive page until the server revalidates it.
    }
  }, [auth.status])

  const refresh = async (signal?: AbortSignal) => {
    if (auth.status !== 'authenticated') return
    setLoading(true)
    setError(undefined)
    try {
      setRequests(await listDataRightsRequests(signal))
    } catch (cause) {
      if ((cause as Error)?.name !== 'AbortError') {
        if (isResourceAccessError(cause)) {
          setRequests([])
          setBabyScoped(false)
          setConfirmSubmit(false)
          void refreshBabiesAfterAccessError(cause)
        }
        setError(cause instanceof Error ? cause.message : '申请记录加载失败')
      }
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }

  useEffect(() => {
    if (auth.status !== 'authenticated') return
    void refreshBabyAccess()
    const controller = new AbortController()
    void refresh(controller.signal)
    return () => controller.abort()
  }, [auth.status, auth.session?.user.id, refreshBabyAccess])

  useDidShow(() => {
    if (auth.status === 'authenticated') void refreshBabyAccess()
  })

  useEffect(() => {
    if (type === 'account_deletion') setBabyScoped(false)
  }, [type])

  const submit = async () => {
    if (submitLock.current || auth.status !== 'authenticated') return
    submitLock.current = true
    setSubmitting(true)
    setError(undefined)
    try {
      const created = await createDataRightsRequest({
        type,
        ...(babyScoped && currentBaby ? { babyId: currentBaby.id } : {}),
      })
      setRequests((current) => [
        created,
        ...current.filter((item) => item.id !== created.id),
      ])
      setConfirmSubmit(false)
      await platform.showToast('申请已记录，等待人工核验')
    } catch (cause) {
      if (isResourceAccessError(cause)) {
        setBabyScoped(false)
        void refreshBabiesAfterAccessError(cause, babyScoped ? currentBaby?.id : undefined)
      }
      setError(cause instanceof Error ? cause.message : '申请提交失败')
      setConfirmSubmit(false)
    } finally {
      submitLock.current = false
      setSubmitting(false)
    }
  }

  const cancel = async () => {
    if (!cancelTarget || cancelLock.current) return
    cancelLock.current = true
    setSubmitting(true)
    setError(undefined)
    try {
      await cancelDataRightsRequest(cancelTarget.id)
      setCancelTarget(undefined)
      await refresh()
      await platform.showToast('申请已取消')
    } catch (cause) {
      if (isResourceAccessError(cause)) {
        setBabyScoped(false)
        void refreshBabiesAfterAccessError(cause, cancelTarget.babyId ?? undefined)
      }
      setError(cause instanceof Error ? cause.message : '取消失败')
      setCancelTarget(undefined)
    } finally {
      cancelLock.current = false
      setSubmitting(false)
    }
  }

  if (auth.status === 'restoring') {
    return <View className="data-rights-panel"><PageState kind="loading" title="正在确认登录状态" /></View>
  }
  if (auth.status !== 'authenticated') {
    return (
      <View className="data-rights-panel surface-card">
        <Text className="data-rights-panel__title">提交和查看申请</Text>
        <Text className="data-rights-panel__notice">登录后才能提交申请和查看只属于你的处理状态。</Text>
        <Button className="secondary-button" onClick={() => void platform.navigateTo('/pages/auth/index')}>
          前往登录
        </Button>
      </View>
    )
  }

  return (
    <View className="data-rights-panel">
      <View className="data-rights-panel__form surface-card">
        <Text className="data-rights-panel__title">提交数据权利申请</Text>
        <Text className="data-rights-panel__notice">
          产品会记录申请并交由人工核验。提交成功不等于账号、宝宝数据、备份或审计记录已被删除或更改。
        </Text>
        <View className="data-rights-panel__types">
          {REQUEST_TYPES.map((option) => (
            <Button
              key={option.type}
              className={`data-rights-panel__type${type === option.type ? ' data-rights-panel__type--selected' : ''}`}
              disabled={submitting}
              onClick={() => setType(option.type)}
            >
              <Text>{dataRightsTypeLabel(option.type)}</Text>
              <Text>{option.description}</Text>
            </Button>
          ))}
        </View>
        {type !== 'account_deletion' && currentBaby ? (
          <View className="data-rights-panel__scope">
            <View>
              <Text>仅限当前宝宝</Text>
              <Text>当前选择：{currentBaby.name}</Text>
            </View>
            <Switch
              checked={babyScoped}
              disabled={submitting}
              onChange={(event) => setBabyScoped(event.detail.value)}
            />
          </View>
        ) : (
          <Text className="data-rights-panel__account-scope">
            {type === 'account_deletion' ? '账号注销申请固定为整个账号范围。' : '当前没有可选宝宝，本次为账号范围。'}
          </Text>
        )}
        <Button
          className="primary-button"
          disabled={submitting}
          onClick={() => setConfirmSubmit(true)}
        >
          提交申请
        </Button>
      </View>

      <View className="data-rights-panel__history">
        <Text className="data-rights-panel__title">我的申请记录</Text>
        {loading && requests.length === 0 ? <PageState kind="loading" title="正在加载申请记录" /> : null}
        {!loading && !error && requests.length === 0 ? (
          <PageState kind="empty" title="还没有申请记录" description="提交后可在这里查看人工处理状态。" />
        ) : null}
        {error ? (
          <View className="data-rights-panel__error">
            <Text>{error}</Text>
            <Button size="mini" onClick={() => void refresh()}>重试</Button>
          </View>
        ) : null}
        {requests.map((request) => (
          <View className="data-rights-request surface-card" key={request.id}>
            <View className="data-rights-request__heading">
              <Text>{dataRightsTypeLabel(request.type)}</Text>
              <Text className={`data-rights-request__status data-rights-request__status--${request.status}`}>
                {dataRightsStatusLabel(request.status)}
              </Text>
            </View>
            <Text className="data-rights-request__scope">
              范围：{request.babyId ? '提交时选择的宝宝' : '整个账号'}
            </Text>
            <Text className="data-rights-request__time">
              提交于 {new Date(request.createdAt).toLocaleString()}
            </Text>
            {request.status === 'pending' ? (
              <Button
                className="data-rights-request__cancel"
                size="mini"
                disabled={submitting}
                onClick={() => setCancelTarget(request)}
              >
                取消申请
              </Button>
            ) : null}
          </View>
        ))}
      </View>

      <ConfirmDialog
        open={confirmSubmit}
        title="确认提交申请？"
        description={dataRightsConfirmation(type, babyScoped ? currentBaby?.name : undefined)}
        confirmLabel="确认提交"
        cancelLabel="返回检查"
        danger={type === 'account_deletion'}
        loading={submitting}
        onCancel={() => setConfirmSubmit(false)}
        onConfirm={() => void submit()}
      />
      <ConfirmDialog
        open={Boolean(cancelTarget)}
        title="取消这项申请？"
        description="只有待人工核验的申请可以取消。取消后如仍有需要，可以重新提交。"
        confirmLabel="确认取消"
        cancelLabel="保留申请"
        loading={submitting}
        onCancel={() => setCancelTarget(undefined)}
        onConfirm={() => void cancel()}
      />
    </View>
  )
}

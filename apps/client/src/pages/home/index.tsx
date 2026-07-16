import { Text, View } from '@tarojs/components'
import { useCallback, useEffect, useState } from 'react'

import { PageState } from '../../components/PageState'
import { ApiClientError } from '../../services/api-error'
import { fetchHealth } from '../../services/health'

import './index.scss'

type HealthViewState =
  | { kind: 'loading' }
  | { kind: 'success'; version: string }
  | { kind: 'error'; message: string; requestId?: string }

export default function HomePage() {
  const [state, setState] = useState<HealthViewState>({ kind: 'loading' })

  const loadHealth = useCallback(async () => {
    setState({ kind: 'loading' })
    try {
      const response = await fetchHealth()
      setState({ kind: 'success', version: response.data.version })
    } catch (error) {
      const clientError = error instanceof ApiClientError ? error : undefined
      setState({
        kind: 'error',
        message: clientError?.message ?? '加载失败，请稍后重试',
        requestId: clientError?.requestId,
      })
    }
  }, [])

  useEffect(() => {
    void loadHealth()
  }, [loadHealth])

  return (
    <View className="page-shell">
      <View className="page-heading">
        <Text className="page-title">宝宝成长记</Text>
        <Text className="page-description">珍藏成长点滴，与家人安心分享。</Text>
      </View>

      {state.kind === 'loading' ? <PageState kind="loading" title="正在连接本地服务" /> : null}
      {state.kind === 'error' ? (
        <PageState
          kind="error"
          title="暂时无法连接服务"
          description={`${state.message}${state.requestId ? `（请求编号：${state.requestId}）` : ''}`}
          actionLabel="重新连接"
          onAction={() => void loadHealth()}
        />
      ) : null}
      {state.kind === 'success' ? (
        <View className="surface-card health-card">
          <View className="health-card__badge">服务已连接</View>
          <Text className="health-card__title">工程基础运行正常</Text>
          <Text className="health-card__description">API 版本 {state.version}</Text>
        </View>
      ) : null}
    </View>
  )
}

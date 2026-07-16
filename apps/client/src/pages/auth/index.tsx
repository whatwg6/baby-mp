import { Button, Checkbox, Label, Text, View } from '@tarojs/components'
import { useEffect, useState } from 'react'

import { platform } from '../../platform'
import { ApiClientError } from '../../services/api-error'
import { mockLogin, platformLogin } from '../../features/auth/api'
import { resolveAuthenticatedLanding } from '../../features/auth/navigation'
import { restoreAuth, saveSession } from '../../features/auth/store'

import './index.scss'

const showMockLogin = process.env.NODE_ENV === 'development'

export default function AuthPage() {
  const [accepted, setAccepted] = useState(false)
  const [loading, setLoading] = useState<'platform' | 'mock' | null>(null)
  const [error, setError] = useState('')

  const login = async (kind: 'platform' | 'mock') => {
    if (!accepted) { setError('请先阅读并同意隐私政策和用户协议'); return }
    setError(''); setLoading(kind)
    try {
      const session = kind === 'mock'
        ? await mockLogin('parent-a', '测试妈妈')
        : await platform.login().then((result) => platformLogin(result.code))
      await saveSession(session)
      await resolveAuthenticatedLanding()
    } catch (reason) {
      setError(reason instanceof ApiClientError ? reason.message : '登录失败，请稍后重试')
    } finally { setLoading(null) }
  }

  useEffect(() => {
    void restoreAuth().then((auth) => {
      if (auth.status === 'authenticated') void resolveAuthenticatedLanding()
    })
  }, [])

  return (
    <View className="auth-page">
      <View className="auth-brand"><View className="auth-brand__mark">宝</View><Text className="auth-brand__title">宝宝成长记</Text>
        <Text className="auth-brand__description">珍藏成长点滴，与家人安心分享。</Text></View>
      <View className="auth-card">
        <Label className="privacy-consent"><Checkbox value="accepted" checked={accepted} onClick={() => { setAccepted(!accepted); setError('') }} color="#a95d42" />
          <Text>我已阅读并同意《隐私政策》和《用户协议》</Text></Label>
        {error ? <Text className="auth-error">{error}</Text> : null}
        <Button className="primary-button" loading={loading === 'platform'} disabled={loading !== null}
          onClick={() => void login('platform')}>微信登录</Button>
        {showMockLogin ? <Button className="secondary-button" loading={loading === 'mock'} disabled={loading !== null}
          onClick={() => void login('mock')}>以测试用户登录</Button> : null}
      </View>
    </View>
  )
}

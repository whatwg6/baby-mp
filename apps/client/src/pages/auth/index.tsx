import { Button, Checkbox, Label, Text, View } from '@tarojs/components'
import { useEffect, useState } from 'react'

import { platform } from '../../platform'
import { ApiClientError } from '../../services/api-error'
import { platformLogin } from '../../features/auth/api'
import { resolveAuthenticatedLanding } from '../../features/auth/navigation'
import { restoreAuth, saveSession } from '../../features/auth/store'
import { rememberInviteToken } from '../../features/family/invite-context'
import { MockLoginButton } from '@mock-login-boundary'

import './index.scss'

export default function AuthPage() {
  const [accepted, setAccepted] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const login = async () => {
    if (!accepted) { setError('请先阅读并同意隐私政策和用户协议'); return }
    setError(''); setLoading(true)
    try {
      const session = await platform.login().then((result) => platformLogin(result.code))
      await saveSession(session)
      await resolveAuthenticatedLanding()
    } catch (reason) {
      setError(reason instanceof ApiClientError ? reason.message : '登录失败，请稍后重试')
    } finally { setLoading(false) }
  }

  useEffect(() => {
    const token = platform.getRouteParams().token
    void (token ? rememberInviteToken(token) : Promise.resolve()).then(() => restoreAuth()).then((auth) => {
      if (auth.status === 'authenticated') void resolveAuthenticatedLanding()
    })
  }, [])

  return (
    <View className="auth-page">
      <View className="auth-brand"><View className="auth-brand__mark">宝</View><Text className="auth-brand__title">宝宝成长记</Text>
        <Text className="auth-brand__description">珍藏成长点滴，与家人安心分享。</Text></View>
      <View className="auth-card">
        <Label className="privacy-consent"><Checkbox value="accepted" checked={accepted} onClick={() => { setAccepted(!accepted); setError('') }} color="#a95d42" />
          <Text>我已阅读并同意</Text>
          <Text onClick={(event) => { event.stopPropagation(); void platform.navigateTo('/pages/legal/privacy') }}>《隐私政策》</Text>
          <Text>和</Text>
          <Text onClick={(event) => { event.stopPropagation(); void platform.navigateTo('/pages/legal/terms') }}>《用户协议》</Text>
        </Label>
        {error ? <Text className="auth-error">{error}</Text> : null}
        <Button className="primary-button" loading={loading} disabled={loading}
          onClick={() => void login()}>微信登录</Button>
        <MockLoginButton accepted={accepted} busy={loading} onBusyChange={setLoading} onError={setError} />
      </View>
    </View>
  )
}

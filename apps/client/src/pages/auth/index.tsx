import { Button, Checkbox, Label, Text, View } from '@tarojs/components'
import { useEffect, useState } from 'react'

import { platform } from '../../platform'
import { ApiClientError } from '../../services/api-error'
import { resolveAuthenticatedLanding } from '../../features/auth/navigation'
import { restoreAuth } from '../../features/auth/store'
import {
  loadPendingInviteLoginSummary,
  type PendingInviteLoginSummary,
} from '../../features/family/invite-context'
import { MockLoginButton } from '@mock-login-boundary'
import { completePlatformLogin } from './login-flow'

import './index.scss'

export default function AuthPage() {
  const [accepted, setAccepted] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [inviteSummary, setInviteSummary] = useState<PendingInviteLoginSummary>()

  const login = async () => {
    if (!accepted) { setError('请先阅读并同意隐私政策和用户协议'); return }
    setError(''); setLoading(true)
    try {
      await completePlatformLogin()
    } catch (reason) {
      setError(reason instanceof ApiClientError ? reason.message : '登录失败，请稍后重试')
    } finally { setLoading(false) }
  }

  useEffect(() => {
    const token = platform.getRouteParams().token
    void loadPendingInviteLoginSummary(token).then(setInviteSummary).then(() => restoreAuth()).then((auth) => {
      if (auth.status === 'authenticated') void resolveAuthenticatedLanding()
    })
  }, [])

  return (
    <View className="auth-page">
      <View className="auth-brand"><View className="auth-brand__mark">宝</View><Text className="auth-brand__title">宝宝成长记</Text>
        <Text className="auth-brand__description">珍藏成长点滴，与家人安心分享。</Text></View>
      <View className="auth-card">
        {inviteSummary ? <View className="auth-invite-summary">
          <Text className="auth-invite-summary__title">登录后继续确认邀请</Text>
          <Text className="auth-invite-summary__description">
            {inviteSummary.babyName && inviteSummary.inviterName
              ? `${inviteSummary.inviterName} 邀请你加入 ${inviteSummary.babyName} 的家庭，登录后仍需确认。`
              : '你有一条待处理的家庭邀请，登录后可查看安全摘要并决定是否加入。'}
          </Text>
        </View> : null}
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

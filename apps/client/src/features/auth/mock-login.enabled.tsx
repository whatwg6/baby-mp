import { authSessionSchema, successResponseSchema } from '@baby-mp/contracts'
import { Button } from '@tarojs/components'

import { createApiClient } from '../../services/api-client'
import { ApiClientError } from '../../services/api-error'
import { resolveAuthenticatedLanding } from './navigation'
import { saveSession } from './store'
import type { Session } from './types'
import type { MockLoginButtonProps } from './mock-login.types'

const sessionResponseSchema = successResponseSchema(authSessionSchema)

async function mockLogin(mockUserKey: string, displayName: string): Promise<Session> {
  const response = await createApiClient().request({
    path: '/api/v1/auth/mock-login', method: 'POST', body: { mockUserKey, displayName },
    schema: sessionResponseSchema, skipAuth: true, skipRefresh: true,
  })
  return response.data
}

export function MockLoginButton({
  accepted,
  busy,
  onBusyChange,
  onError,
}: MockLoginButtonProps) {
  const login = async () => {
    if (!accepted) { onError('请先阅读并同意隐私政策和用户协议'); return }
    onError('')
    onBusyChange(true)
    try {
      await saveSession(await mockLogin('parent-a', '测试妈妈'))
      await resolveAuthenticatedLanding()
    } catch (reason) {
      onError(reason instanceof ApiClientError ? reason.message : '登录失败，请稍后重试')
    } finally {
      onBusyChange(false)
    }
  }

  return <Button className="secondary-button" loading={busy} disabled={busy}
    onClick={() => void login()}>以测试用户登录</Button>
}

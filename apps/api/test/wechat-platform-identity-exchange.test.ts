import type { ConfigService } from '@nestjs/config'
import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { WechatPlatformIdentityExchange } from '../src/auth/wechat-platform-identity-exchange'
import type { Environment } from '../src/config/environment'

function config(values: Partial<Environment>): ConfigService<Environment, true> {
  return {
    get: vi.fn((key: keyof Environment) => values[key]),
  } as unknown as ConfigService<Environment, true>
}

describe('WechatPlatformIdentityExchange', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('exchanges a code without exposing the platform session key', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          openid: 'wechat-subject',
          unionid: 'wechat-union',
          session_key: 'must-never-leave-the-adapter',
        }),
        { status: 200 },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)
    const exchange = new WechatPlatformIdentityExchange(
      config({
        WECHAT_APP_ID: 'test-app-id',
        WECHAT_APP_SECRET: 'test-app-secret',
        WECHAT_CODE2SESSION_URL: 'https://api.weixin.qq.com/sns/jscode2session',
      }),
    )

    await expect(exchange.exchange('wechat_mini', 'temporary-code')).resolves.toEqual({
      platform: 'wechat_mini',
      appId: 'test-app-id',
      subject: 'wechat-subject',
      unionSubject: 'wechat-union',
    })
    expect(JSON.stringify(await exchange.exchange('wechat_mini', 'another-code'))).not.toContain(
      'session_key',
    )
  })

  it('fails closed when credentials are not configured', async () => {
    const exchange = new WechatPlatformIdentityExchange(
      config({ WECHAT_CODE2SESSION_URL: 'https://api.weixin.qq.com/sns/jscode2session' }),
    )
    await expect(exchange.exchange('wechat_mini', 'temporary-code')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    )
  })

  it('maps a rejected code to a safe authentication error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ errcode: 40029, errmsg: 'invalid code' }), { status: 200 }),
      ),
    )
    const exchange = new WechatPlatformIdentityExchange(
      config({
        WECHAT_APP_ID: 'test-app-id',
        WECHAT_APP_SECRET: 'test-app-secret',
        WECHAT_CODE2SESSION_URL: 'https://api.weixin.qq.com/sns/jscode2session',
      }),
    )
    await expect(exchange.exchange('wechat_mini', 'bad-code')).rejects.toBeInstanceOf(
      UnauthorizedException,
    )
  })
})

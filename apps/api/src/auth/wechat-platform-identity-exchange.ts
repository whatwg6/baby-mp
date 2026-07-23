import {
  BadGatewayException,
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import type { PlatformType } from '@baby-mp/contracts'

import type { Environment } from '../config/environment'
import type {
  ExchangedPlatformIdentity,
  PlatformIdentityExchange,
} from './platform-authentication.port'

interface WechatCodeSessionResponse {
  openid?: string
  unionid?: string
  session_key?: string
  errcode?: number
  errmsg?: string
}

@Injectable()
export class WechatPlatformIdentityExchange implements PlatformIdentityExchange {
  constructor(
    @Inject(ConfigService)
    private readonly config: ConfigService<Environment, true>,
  ) {}

  async exchange(
    platform: PlatformType,
    code: string,
  ): Promise<ExchangedPlatformIdentity> {
    if (platform !== 'wechat_mini') {
      throw new ServiceUnavailableException('该平台登录暂未配置')
    }

    const appId = this.config.get('WECHAT_APP_ID', { infer: true })
    const appSecret = this.config.get('WECHAT_APP_SECRET', { infer: true })
    if (!appId || !appSecret) {
      throw new ServiceUnavailableException('微信登录暂未配置')
    }

    const endpoint = new URL(
      this.config.get('WECHAT_CODE2SESSION_URL', { infer: true }),
    )
    endpoint.search = new URLSearchParams({
      appid: appId,
      secret: appSecret,
      js_code: code,
      grant_type: 'authorization_code',
    }).toString()

    let response: Response
    try {
      response = await fetch(endpoint, {
        method: 'GET',
        signal: AbortSignal.timeout(5_000),
      })
    } catch {
      throw new BadGatewayException('微信登录服务暂时不可用')
    }
    if (!response.ok) {
      throw new BadGatewayException('微信登录服务暂时不可用')
    }

    let payload: WechatCodeSessionResponse
    try {
      payload = (await response.json()) as WechatCodeSessionResponse
    } catch {
      throw new BadGatewayException('微信登录服务返回异常')
    }
    if (payload.errcode || !payload.openid) {
      throw new UnauthorizedException('微信登录凭证无效')
    }

    return {
      platform: 'wechat_mini',
      appId,
      subject: payload.openid,
      ...(payload.unionid ? { unionSubject: payload.unionid } : {}),
    }
  }
}

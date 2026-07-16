import { Module } from '@nestjs/common'

import { AUTHENTICATION_RESOLVER } from './authentication.port'
import { AuthenticationGuard } from './authentication.guard'
import { AuthController } from './auth.controller'
import { AuthService } from './auth.service'
import { PLATFORM_IDENTITY_EXCHANGE } from './platform-authentication.port'
import { TokenService } from './token.service'
import { WechatPlatformIdentityExchange } from './wechat-platform-identity-exchange'

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    TokenService,
    AuthenticationGuard,
    WechatPlatformIdentityExchange,
    { provide: AUTHENTICATION_RESOLVER, useExisting: TokenService },
    { provide: PLATFORM_IDENTITY_EXCHANGE, useExisting: WechatPlatformIdentityExchange },
  ],
  exports: [AuthenticationGuard, AUTHENTICATION_RESOLVER, TokenService],
})
export class AuthModule {}

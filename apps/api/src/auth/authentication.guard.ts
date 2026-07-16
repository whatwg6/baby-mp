import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'

import type { RequestWithContext } from '../common/http/request-context'
import {
  AUTHENTICATION_RESOLVER,
  type AuthenticationResolver,
} from './authentication.port'

@Injectable()
export class AuthenticationGuard implements CanActivate {
  constructor(
    @Inject(AUTHENTICATION_RESOLVER)
    private readonly authenticationResolver: AuthenticationResolver,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithContext>()
    const authorization = request.header('authorization')
    const match = authorization?.match(/^Bearer ([^\s]+)$/)

    if (!match?.[1]) {
      throw new UnauthorizedException('需要登录后继续')
    }

    const user = await this.authenticationResolver.resolve(match[1])
    if (!user) {
      throw new UnauthorizedException('登录状态已失效')
    }

    request.user = user
    return true
  }
}

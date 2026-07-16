import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'

import type { RequestWithContext } from '../../common/http/request-context'
import {
  BABY_MEMBERSHIP_REPOSITORY,
  BABY_RESOURCE_RESOLVER,
  type BabyMembershipRepository,
  type BabyResourceResolver,
} from './baby-authorization.port'
import { REQUIRED_BABY_ROLES } from './required-baby-roles.decorator'

@Injectable()
export class BabyMemberGuard implements CanActivate {
  constructor(
    @Inject(Reflector)
    private readonly reflector: Reflector,
    @Inject(BABY_RESOURCE_RESOLVER)
    private readonly resourceResolver: BabyResourceResolver,
    @Inject(BABY_MEMBERSHIP_REPOSITORY)
    private readonly membershipRepository: BabyMembershipRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithContext>()
    if (!request.user) {
      throw new NotFoundException('资源不存在')
    }

    const resource = await this.resourceResolver.resolve(request)
    if (!resource) {
      throw new NotFoundException('资源不存在')
    }

    const membership = await this.membershipRepository.findActiveMembership(
      request.user.id,
      resource.babyId,
    )
    if (!membership) {
      throw new NotFoundException('资源不存在')
    }

    const requiredRoles = this.reflector.getAllAndOverride<readonly string[]>(
      REQUIRED_BABY_ROLES,
      [context.getHandler(), context.getClass()],
    )
    if (requiredRoles?.length && !requiredRoles.includes(membership.role)) {
      throw new NotFoundException('资源不存在')
    }

    return true
  }
}

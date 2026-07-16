import { SetMetadata } from '@nestjs/common'

import type { BabyMemberRole } from './baby-authorization.port'

export const REQUIRED_BABY_ROLES = 'requiredBabyRoles'

export const RequireBabyRoles = (...roles: BabyMemberRole[]): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRED_BABY_ROLES, roles)

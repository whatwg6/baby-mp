import { Module } from '@nestjs/common'

import { AuthModule } from '../auth/auth.module'
import {
  BABY_MEMBERSHIP_REPOSITORY,
  BABY_RESOURCE_RESOLVER,
} from '../families/authorization/baby-authorization.port'
import { BabyMemberGuard } from '../families/authorization/baby-member.guard'
import { PrismaBabyMembershipRepository } from './baby-authorization.repository'
import { RouteBabyResourceResolver } from './baby-resource.resolver'
import { BabiesController } from './babies.controller'
import { BabiesService } from './babies.service'

@Module({
  imports: [AuthModule],
  controllers: [BabiesController],
  providers: [
    BabiesService,
    BabyMemberGuard,
    PrismaBabyMembershipRepository,
    RouteBabyResourceResolver,
    { provide: BABY_MEMBERSHIP_REPOSITORY, useExisting: PrismaBabyMembershipRepository },
    { provide: BABY_RESOURCE_RESOLVER, useExisting: RouteBabyResourceResolver },
  ],
})
export class BabiesModule {}

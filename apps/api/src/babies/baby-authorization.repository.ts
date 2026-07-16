import { Inject, Injectable } from '@nestjs/common'
import { MemberStatus } from '@prisma/client'

import { PrismaService } from '../database/prisma.service'
import type {
  ActiveBabyMembership,
  BabyMembershipRepository,
} from '../families/authorization/baby-authorization.port'

@Injectable()
export class PrismaBabyMembershipRepository implements BabyMembershipRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async findActiveMembership(
    userId: string,
    babyId: string,
  ): Promise<ActiveBabyMembership | null> {
    const membership = await this.prisma.babyMember.findFirst({
      where: {
        userId,
        babyId,
        status: MemberStatus.active,
        baby: { deletedAt: null },
      },
      select: { userId: true, babyId: true, role: true },
    })
    return membership
  }
}

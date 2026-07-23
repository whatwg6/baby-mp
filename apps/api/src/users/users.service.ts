import { BadRequestException, Inject, Injectable } from '@nestjs/common'

import {
  updateCurrentUserInputSchema,
  type UpdateCurrentUserInput,
  type UserSummary,
} from '@baby-mp/contracts'

import { PrismaService } from '../database/prisma.service'

@Injectable()
export class UsersService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async updateCurrentUser(userId: string, input: UpdateCurrentUserInput): Promise<UserSummary> {
    const parsed = updateCurrentUserInputSchema.safeParse(input)
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: '提交内容有误',
        details: [{ field: 'displayName', reason: '显示名需为 1–80 个字符' }],
      })
    }
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { displayName: parsed.data.displayName },
      select: { id: true, displayName: true },
    })
    return { id: user.id, displayName: user.displayName, avatarUrl: null }
  }
}

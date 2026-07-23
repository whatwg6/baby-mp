import { createHash, createHmac } from 'node:crypto'

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import {
  InviteStatus,
  MemberRole,
  MemberStatus,
  Prisma,
  type Baby as PrismaBaby,
  type BabyMember as PrismaBabyMember,
  type FamilyInvite as PrismaFamilyInvite,
  type User as PrismaUser,
} from '@prisma/client'

import type {
  AcceptedInvite,
  Baby,
  CreatedFamilyInvite,
  FamilyInvite,
  FamilyMember,
  InvitePreview,
} from '@baby-mp/contracts'

import type { Environment } from '../config/environment'
import { PrismaService } from '../database/prisma.service'
import type { CreateFamilyInviteDto, UpdateFamilyMemberDto } from './family.dto'

const CREATE_INVITE_OPERATION = 'families.invites.create'
const ACCEPT_INVITE_OPERATION = 'families.invites.accept'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/

type InviteWithRelations = PrismaFamilyInvite & {
  creator: Pick<PrismaUser, 'id' | 'displayName'>
  baby?: Pick<PrismaBaby, 'id' | 'name'>
}

type MemberWithUser = PrismaBabyMember & {
  user: Pick<PrismaUser, 'id' | 'displayName'>
}

@Injectable()
export class FamiliesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ConfigService) private readonly config: ConfigService<Environment, true>,
  ) {}

  async listMembers(userId: string, babyId: string): Promise<FamilyMember[]> {
    await this.requireMember(userId, babyId)
    const members = await this.prisma.babyMember.findMany({
      where: { babyId, status: MemberStatus.active },
      include: { user: { select: { id: true, displayName: true } } },
      orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
    })
    return members.map((member) => this.toMember(member, userId))
  }

  async createInvite(
    userId: string,
    babyId: string,
    key: string,
    input: CreateFamilyInviteDto,
    requestId?: string,
  ): Promise<CreatedFamilyInvite> {
    this.assertIdempotencyKey(key)
    const normalized = { babyId, role: input.role, expiresInHours: input.expiresInHours }
    const requestHash = this.hash(this.stableJson(normalized))
    const token = this.deriveToken(userId, key)
    const tokenHash = this.hash(token)

    const execute = () => this.prisma.$transaction(async (tx) => {
      await this.requireAdmin(userId, babyId, tx)
      const existingKey = await tx.idempotencyKey.findUnique({
        where: { userId_operation_key: { userId, operation: CREATE_INVITE_OPERATION, key } },
      })
      if (existingKey) {
        const inviteId = this.replayId(existingKey.requestHash, requestHash, existingKey.responseBody)
        const existingInvite = await tx.familyInvite.findUnique({
          where: { id: inviteId },
          include: { creator: { select: { id: true, displayName: true } } },
        })
        if (!existingInvite) throw new ConflictException({ code: 'CONFLICT', message: '邀请创建状态异常' })
        return this.toCreatedInvite(existingInvite, token)
      }

      await tx.idempotencyKey.create({
        data: { userId, operation: CREATE_INVITE_OPERATION, key, requestHash, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) },
      })
      const invite = await tx.familyInvite.create({
        data: {
          babyId,
          role: input.role as MemberRole,
          tokenHash,
          expiresAt: new Date(Date.now() + input.expiresInHours * 60 * 60 * 1000),
          createdBy: userId,
        },
        include: { creator: { select: { id: true, displayName: true } } },
      })
      await Promise.all([
        tx.idempotencyKey.update({
          where: { userId_operation_key: { userId, operation: CREATE_INVITE_OPERATION, key } },
          data: { responseCode: 201, responseBody: { inviteId: invite.id } },
        }),
        tx.auditLog.create({
          data: { actorUserId: userId, babyId, action: 'family.invite.created', resourceType: 'family_invite', resourceId: invite.id, requestId, metadata: { role: input.role, expiresInHours: input.expiresInHours } },
        }),
      ])
      return this.toCreatedInvite(invite, token)
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })

    return this.retryTransaction(execute)
  }

  async listInvites(userId: string, babyId: string, status?: string): Promise<FamilyInvite[]> {
    await this.requireAdmin(userId, babyId)
    await this.expirePendingInvites(babyId)
    const invites = await this.prisma.familyInvite.findMany({
      where: { babyId, ...(status ? { status: status as InviteStatus } : {}) },
      include: { creator: { select: { id: true, displayName: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    })
    return invites.map((invite) => this.toInvite(invite))
  }

  async preview(rawToken: string): Promise<InvitePreview> {
    const tokenHash = this.validateAndHashToken(rawToken)
    let invite = await this.prisma.familyInvite.findUnique({
      where: { tokenHash },
      include: {
        baby: { select: { id: true, name: true } },
        creator: { select: { id: true, displayName: true } },
      },
    })
    if (!invite?.baby || invite.baby.name.length === 0) {
      throw new NotFoundException({ code: 'INVITE_INVALID', message: '邀请无效' })
    }
    if (invite.status === InviteStatus.pending && invite.expiresAt <= new Date()) {
      invite = await this.prisma.familyInvite.update({
        where: { id: invite.id }, data: { status: InviteStatus.expired },
        include: { baby: { select: { id: true, name: true } }, creator: { select: { id: true, displayName: true } } },
      })
    }
    return {
      baby: { id: invite.baby.id, name: invite.baby.name, avatarUrl: null },
      inviter: this.toUser(invite.creator),
      role: invite.role as 'editor' | 'viewer',
      status: invite.status,
      expiresAt: invite.expiresAt.toISOString(),
    }
  }

  async acceptInvite(
    userId: string,
    key: string,
    rawToken: string,
    requestId?: string,
  ): Promise<AcceptedInvite> {
    this.assertIdempotencyKey(key)
    const tokenHash = this.validateAndHashToken(rawToken)
    const requestHash = this.hash(tokenHash)

    const execute = () => this.prisma.$transaction(async (tx) => {
      const existingKey = await tx.idempotencyKey.findUnique({
        where: { userId_operation_key: { userId, operation: ACCEPT_INVITE_OPERATION, key } },
      })
      if (existingKey) {
        const memberId = this.replayId(existingKey.requestHash, requestHash, existingKey.responseBody, 'memberId')
        return this.acceptedResponse(tx, userId, memberId)
      }

      const invite = await tx.familyInvite.findUnique({ where: { tokenHash } })
      if (!invite) throw new NotFoundException({ code: 'INVITE_INVALID', message: '邀请无效' })
      const existingMember = await tx.babyMember.findUnique({
        where: { babyId_userId: { babyId: invite.babyId, userId } },
      })
      if (existingMember?.status === MemberStatus.active) {
        throw new ConflictException({ code: 'ALREADY_A_MEMBER', message: '你已经是该宝宝的家庭成员' })
      }
      this.assertInviteCanBeAccepted(invite)

      await tx.idempotencyKey.create({
        data: { userId, operation: ACCEPT_INVITE_OPERATION, key, requestHash, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) },
      })
      const claimed = await tx.familyInvite.updateMany({
        where: { id: invite.id, status: InviteStatus.pending, expiresAt: { gt: new Date() } },
        data: { status: InviteStatus.accepted, acceptedBy: userId, acceptedAt: new Date() },
      })
      if (claimed.count !== 1) throw new ConflictException({ code: 'INVITE_ALREADY_USED', message: '邀请已被使用' })

      const member = existingMember
        ? await tx.babyMember.update({
          where: { id: existingMember.id },
          data: { role: invite.role, status: MemberStatus.active, joinedAt: new Date(), invitedBy: invite.createdBy, removedAt: null, removedBy: null, version: { increment: 1 } },
        })
        : await tx.babyMember.create({
          data: { babyId: invite.babyId, userId, role: invite.role, status: MemberStatus.active, invitedBy: invite.createdBy },
        })
      await Promise.all([
        tx.idempotencyKey.update({
          where: { userId_operation_key: { userId, operation: ACCEPT_INVITE_OPERATION, key } },
          data: { responseCode: 200, responseBody: { memberId: member.id } },
        }),
        tx.auditLog.create({
          data: { actorUserId: userId, babyId: invite.babyId, action: 'family.invite.accepted', resourceType: 'family_invite', resourceId: invite.id, requestId, metadata: { role: invite.role } },
        }),
      ])
      return this.acceptedResponse(tx, userId, member.id)
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })

    return this.retryTransaction(execute)
  }

  async revokeInvite(userId: string, babyId: string, inviteId: string, requestId?: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.requireAdmin(userId, babyId, tx)
      const result = await tx.familyInvite.updateMany({
        where: { id: inviteId, babyId, status: InviteStatus.pending },
        data: { status: InviteStatus.revoked, revokedAt: new Date() },
      })
      if (result.count !== 1) throw new NotFoundException('资源不存在')
      await tx.auditLog.create({
        data: { actorUserId: userId, babyId, action: 'family.invite.revoked', resourceType: 'family_invite', resourceId: inviteId, requestId },
      })
    })
  }

  async updateMember(
    userId: string,
    babyId: string,
    memberId: string,
    input: UpdateFamilyMemberDto,
    requestId?: string,
  ): Promise<FamilyMember> {
    const execute = () => this.prisma.$transaction(async (tx) => {
      await this.requireAdmin(userId, babyId, tx)
      const target = await tx.babyMember.findFirst({ where: { id: memberId, babyId, status: MemberStatus.active } })
      if (!target) throw new NotFoundException('资源不存在')
      if (target.role === MemberRole.admin && input.role !== 'admin') await this.assertNotLastAdmin(tx, babyId)
      const changed = await tx.babyMember.updateMany({
        where: { id: memberId, babyId, status: MemberStatus.active, version: input.version },
        data: { role: input.role as MemberRole, version: { increment: 1 } },
      })
      if (changed.count !== 1) throw new ConflictException({ code: 'VERSION_CONFLICT', message: '成员信息已变化，请刷新后重试' })
      const updated = await tx.babyMember.findUniqueOrThrow({
        where: { id: memberId }, include: { user: { select: { id: true, displayName: true } } },
      })
      await tx.auditLog.create({
        data: { actorUserId: userId, babyId, action: 'family.member.role_changed', resourceType: 'baby_member', resourceId: memberId, requestId, metadata: { fromRole: target.role, toRole: input.role } },
      })
      return this.toMember(updated, userId)
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
    return this.retryTransaction(execute)
  }

  async removeMember(
    userId: string,
    babyId: string,
    memberId: string,
    version: number,
    requestId?: string,
  ): Promise<void> {
    const execute = () => this.prisma.$transaction(async (tx) => {
      await this.requireAdmin(userId, babyId, tx)
      const target = await tx.babyMember.findFirst({ where: { id: memberId, babyId, status: MemberStatus.active } })
      if (!target) throw new NotFoundException('资源不存在')
      if (target.role === MemberRole.admin) await this.assertNotLastAdmin(tx, babyId)
      const removed = await tx.babyMember.updateMany({
        where: { id: memberId, babyId, status: MemberStatus.active, version },
        data: { status: MemberStatus.removed, removedAt: new Date(), removedBy: userId, version: { increment: 1 } },
      })
      if (removed.count !== 1) throw new ConflictException({ code: 'VERSION_CONFLICT', message: '成员信息已变化，请刷新后重试' })
      await tx.auditLog.create({
        data: { actorUserId: userId, babyId, action: 'family.member.removed', resourceType: 'baby_member', resourceId: memberId, requestId, metadata: { previousRole: target.role } },
      })
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
    await this.retryTransaction(execute)
  }

  async leaveFamily(
    userId: string,
    babyId: string,
    version: number,
    requestId?: string,
  ): Promise<void> {
    const execute = () => this.prisma.$transaction(async (tx) => {
      const member = await this.requireMember(userId, babyId, tx)
      if (member.role === MemberRole.admin) await this.assertNotLastAdmin(tx, babyId)
      const removed = await tx.babyMember.updateMany({
        where: {
          id: member.id,
          babyId,
          userId,
          status: MemberStatus.active,
          version,
        },
        data: {
          status: MemberStatus.removed,
          removedAt: new Date(),
          removedBy: userId,
          version: { increment: 1 },
        },
      })
      if (removed.count !== 1) {
        throw new ConflictException({ code: 'VERSION_CONFLICT', message: '成员信息已变化，请刷新后重试' })
      }
      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          babyId,
          action: 'family.member.left',
          resourceType: 'baby_member',
          resourceId: member.id,
          requestId,
          metadata: { previousRole: member.role },
        },
      })
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
    await this.retryTransaction(execute)
  }

  private async acceptedResponse(tx: Prisma.TransactionClient, userId: string, memberId: string): Promise<AcceptedInvite> {
    const member = await tx.babyMember.findFirst({
      where: { id: memberId, userId, status: MemberStatus.active },
      include: { user: { select: { id: true, displayName: true } }, baby: true },
    })
    if (!member) throw new ConflictException({ code: 'CONFLICT', message: '邀请接受状态异常' })
    return { baby: this.toBaby(member.baby, member.role), member: this.toMember(member, userId) }
  }

  private async requireMember(userId: string, babyId: string, tx: Prisma.TransactionClient | PrismaService = this.prisma): Promise<PrismaBabyMember> {
    const member = await tx.babyMember.findFirst({ where: { userId, babyId, status: MemberStatus.active, baby: { deletedAt: null } } })
    if (!member) throw new NotFoundException('资源不存在')
    return member
  }

  private async requireAdmin(userId: string, babyId: string, tx: Prisma.TransactionClient | PrismaService = this.prisma): Promise<PrismaBabyMember> {
    const member = await this.requireMember(userId, babyId, tx)
    if (member.role !== MemberRole.admin) throw new ForbiddenException({ code: 'FORBIDDEN', message: '仅管理员可执行此操作' })
    return member
  }

  private async assertNotLastAdmin(tx: Prisma.TransactionClient, babyId: string): Promise<void> {
    const admins = await tx.babyMember.count({ where: { babyId, status: MemberStatus.active, role: MemberRole.admin } })
    if (admins <= 1) throw new ConflictException({ code: 'LAST_ADMIN_REQUIRED', message: '必须至少保留一位管理员' })
  }

  private assertInviteCanBeAccepted(invite: PrismaFamilyInvite): void {
    if (invite.status === InviteStatus.revoked) throw new ConflictException({ code: 'INVITE_REVOKED', message: '邀请已撤销' })
    if (invite.status === InviteStatus.accepted) throw new ConflictException({ code: 'INVITE_ALREADY_USED', message: '邀请已被使用' })
    if (invite.status === InviteStatus.expired || invite.expiresAt <= new Date()) throw new ConflictException({ code: 'INVITE_EXPIRED', message: '邀请已过期' })
  }

  private async expirePendingInvites(babyId: string): Promise<void> {
    await this.prisma.familyInvite.updateMany({
      where: { babyId, status: InviteStatus.pending, expiresAt: { lte: new Date() } },
      data: { status: InviteStatus.expired },
    })
  }

  private toMember(member: MemberWithUser, currentUserId: string): FamilyMember {
    return {
      id: member.id,
      user: this.toUser(member.user),
      role: member.role,
      status: member.status,
      joinedAt: member.joinedAt.toISOString(),
      version: member.version,
      isCurrentUser: member.userId === currentUserId,
    }
  }

  private toInvite(invite: InviteWithRelations): FamilyInvite {
    return {
      id: invite.id,
      role: invite.role as 'editor' | 'viewer',
      status: invite.status,
      expiresAt: invite.expiresAt.toISOString(),
      createdAt: invite.createdAt.toISOString(),
      inviter: this.toUser(invite.creator),
    }
  }

  private toCreatedInvite(invite: InviteWithRelations, token: string): CreatedFamilyInvite {
    return { ...this.toInvite(invite), token, sharePath: `/pages/family/invite?token=${encodeURIComponent(token)}` }
  }

  private toUser(user: Pick<PrismaUser, 'id' | 'displayName'>) {
    return { id: user.id, displayName: user.displayName?.trim() || '家庭成员', avatarUrl: null }
  }

  private toBaby(baby: PrismaBaby, role: MemberRole): Baby {
    return {
      id: baby.id,
      name: baby.name,
      gender: baby.gender,
      birthDate: baby.birthDate.toISOString().slice(0, 10),
      birthTime: baby.birthTime?.toISOString().slice(11, 16) ?? null,
      birthHeightCm: baby.birthHeightCm === null ? null : Number(baby.birthHeightCm),
      birthWeightKg: baby.birthWeightKg === null ? null : Number(baby.birthWeightKg),
      avatarUrl: null,
      role,
      version: baby.version,
      createdAt: baby.createdAt.toISOString(),
      updatedAt: baby.updatedAt.toISOString(),
    }
  }

  private deriveToken(userId: string, key: string): string {
    return createHmac('sha256', this.config.get('JWT_ACCESS_SECRET', { infer: true }))
      .update(`family-invite:v1:${userId}:${key}`)
      .digest('base64url')
  }

  private validateAndHashToken(token: string): string {
    if (!TOKEN_PATTERN.test(token)) throw new BadRequestException({ code: 'INVITE_INVALID', message: '邀请无效' })
    return this.hash(token)
  }

  private assertIdempotencyKey(key: string): void {
    if (!UUID_PATTERN.test(key)) throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Idempotency-Key 必须是 UUID' })
  }

  private replayId(storedHash: string, requestHash: string, body: Prisma.JsonValue | null, field = 'inviteId'): string {
    if (storedHash !== requestHash) throw new ConflictException({ code: 'IDEMPOTENCY_CONFLICT', message: '幂等键已用于不同请求' })
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ConflictException({ code: 'CONFLICT', message: '请求正在处理中，请稍后重试' })
    const value = (body as Record<string, Prisma.JsonValue>)[field]
    if (typeof value !== 'string') throw new ConflictException({ code: 'CONFLICT', message: '请求状态异常' })
    return value
  }

  private hash(value: string): string { return createHash('sha256').update(value).digest('hex') }
  private stableJson(value: Record<string, unknown>): string { return JSON.stringify(Object.keys(value).sort().reduce<Record<string, unknown>>((result, key) => { result[key] = value[key]; return result }, {})) }

  private async retryTransaction<T>(execute: () => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try { return await execute() } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2034'].includes(error.code) && attempt < 2) continue
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException({ code: 'CONFLICT', message: '请求冲突，请重试' })
        throw error
      }
    }
    throw new ConflictException({ code: 'CONFLICT', message: '请求冲突，请重试' })
  }
}

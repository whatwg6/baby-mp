import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common'
import {
  DataRightsRequestStatus,
  DataRightsRequestType,
  MemberStatus,
} from '@prisma/client'
import { describe, expect, it, vi } from 'vitest'

import type { PrismaService } from '../src/database/prisma.service'
import {
  DataRightsService,
  type DataRightsOperatorTargetStatus,
} from '../src/data-rights/data-rights.service'

const userId = '11111111-1111-4111-8111-111111111111'
const otherUserId = '22222222-2222-4222-8222-222222222222'
const babyId = '33333333-3333-4333-8333-333333333333'
const requestId = '44444444-4444-4444-8444-444444444444'
const now = new Date('2026-07-18T08:00:00.000Z')

function request(overrides: Record<string, unknown> = {}) {
  return {
    id: requestId,
    requesterUserId: userId,
    babyId: null,
    type: DataRightsRequestType.account_deletion,
    status: DataRightsRequestStatus.pending,
    activeRequestKey: `${userId}:account_deletion:account`,
    createdAt: now,
    updatedAt: now,
    resolvedAt: null,
    ...overrides,
  }
}

function service(prisma: object) {
  return new DataRightsService(prisma as PrismaService)
}

describe('M7 DataRightsService', () => {
  it('creates a baby-scoped request only after live membership verification and writes low-sensitivity audit', async () => {
    let createData: Record<string, unknown> = {}
    let auditData: Record<string, unknown> = {}
    const created = request({
      babyId,
      type: DataRightsRequestType.data_access,
      activeRequestKey: `${userId}:data_access:${babyId}`,
    })
    const tx = {
      babyMember: {
        findFirst: vi.fn(async () => ({ id: '55555555-5555-4555-8555-555555555555' })),
      },
      dataRightsRequest: {
        findUnique: vi.fn(async () => null),
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          createData = data
          return created
        }),
      },
      auditLog: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          auditData = data
        }),
      },
    }
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
    }

    await expect(service(prisma).create(
      userId,
      { type: 'data_access', babyId },
      'request-trace',
    )).resolves.toMatchObject({ babyId, type: 'data_access', status: 'pending' })
    expect(tx.babyMember.findFirst).toHaveBeenCalledWith({
      where: {
        userId,
        babyId,
        status: MemberStatus.active,
        baby: { deletedAt: null },
      },
      select: { id: true },
    })
    expect(createData).toMatchObject({
      requesterUserId: userId,
      babyId,
      type: DataRightsRequestType.data_access,
      status: DataRightsRequestStatus.pending,
      activeRequestKey: `${userId}:data_access:${babyId}`,
    })
    expect(auditData).toMatchObject({
      actorUserId: userId,
      babyId,
      action: 'data_rights.request.created',
      resourceType: 'data_rights_request',
      resourceId: requestId,
      requestId: 'request-trace',
      metadata: { type: 'data_access', scope: 'baby' },
    })
    expect(JSON.stringify(auditData)).not.toContain('宝宝姓名')
    expect(JSON.stringify(auditData)).not.toContain('正文')
  })

  it('rejects a baby scope for account deletion and a missing live membership', async () => {
    await expect(service({}).create(userId, {
      type: 'account_deletion',
      babyId,
    })).rejects.toBeInstanceOf(BadRequestException)

    const tx = {
      babyMember: { findFirst: vi.fn(async () => null) },
    }
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
    }
    await expect(service(prisma).create(userId, {
      type: 'correction',
      babyId,
    })).rejects.toBeInstanceOf(NotFoundException)
  })

  it('returns an existing active request without creating or auditing another row', async () => {
    const existing = request({ status: DataRightsRequestStatus.processing })
    const tx = {
      dataRightsRequest: {
        findUnique: vi.fn(async () => existing),
      },
    }
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
    }
    await expect(service(prisma).create(userId, {
      type: 'account_deletion',
    })).resolves.toMatchObject({ id: requestId, status: 'processing' })
    expect(tx.dataRightsRequest.findUnique).toHaveBeenCalledWith({
      where: { activeRequestKey: `${userId}:account_deletion:account` },
    })
  })

  it('checks live membership before replaying an active baby-scoped request', async () => {
    const tx = {
      babyMember: { findFirst: vi.fn(async () => null) },
      dataRightsRequest: {
        findUnique: vi.fn(async () => request({
          babyId,
          type: DataRightsRequestType.data_access,
          activeRequestKey: `${userId}:data_access:${babyId}`,
        })),
      },
    }
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
    }

    await expect(service(prisma).create(userId, {
      type: 'data_access',
      babyId,
    })).rejects.toBeInstanceOf(NotFoundException)
    expect(tx.dataRightsRequest.findUnique).not.toHaveBeenCalled()
  })

  it('lists only the authenticated user requests in stable newest-first order', async () => {
    const findMany = vi.fn(async () => [request()])
    const prisma = { dataRightsRequest: { findMany } }
    await expect(service(prisma).list(userId)).resolves.toHaveLength(1)
    expect(findMany).toHaveBeenCalledWith({
      where: { requesterUserId: userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    })
  })

  it('cancels only the owner pending request, clears the active key, and audits without content', async () => {
    let updateData: Record<string, unknown> = {}
    let auditData: Record<string, unknown> = {}
    const tx = {
      dataRightsRequest: {
        findFirst: vi.fn(async () => request()),
        updateMany: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          updateData = data
          return { count: 1 }
        }),
      },
      auditLog: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          auditData = data
        }),
      },
    }
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
    }
    await service(prisma).cancel(userId, requestId, 'cancel-trace')
    expect(tx.dataRightsRequest.findFirst).toHaveBeenCalledWith({
      where: { id: requestId, requesterUserId: userId },
    })
    expect(updateData).toMatchObject({
      status: DataRightsRequestStatus.cancelled,
      activeRequestKey: null,
      resolvedAt: expect.any(Date),
    })
    expect(auditData).toMatchObject({
      actorUserId: userId,
      action: 'data_rights.request.cancelled',
      resourceId: requestId,
      requestId: 'cancel-trace',
      metadata: { type: 'account_deletion', scope: 'account' },
    })
  })

  it('does not reveal another user request and refuses to cancel processing requests', async () => {
    const missingTx = {
      dataRightsRequest: { findFirst: vi.fn(async () => null) },
    }
    const missingPrisma = {
      $transaction: vi.fn(async (callback: (client: typeof missingTx) => Promise<unknown>) => callback(missingTx)),
    }
    await expect(service(missingPrisma).cancel(otherUserId, requestId))
      .rejects.toBeInstanceOf(NotFoundException)

    const processingTx = {
      dataRightsRequest: {
        findFirst: vi.fn(async () => request({ status: DataRightsRequestStatus.processing })),
      },
    }
    const processingPrisma = {
      $transaction: vi.fn(async (callback: (client: typeof processingTx) => Promise<unknown>) => callback(processingTx)),
    }
    await expect(service(processingPrisma).cancel(userId, requestId))
      .rejects.toBeInstanceOf(ConflictException)
  })

  it('moves an operator-verified request to a terminal state, releases its active key, and audits', async () => {
    let updateData: Record<string, unknown> = {}
    let auditData: Record<string, unknown> = {}
    const completed = request({
      status: DataRightsRequestStatus.completed,
      activeRequestKey: null,
      resolvedAt: now,
    })
    const tx = {
      dataRightsRequest: {
        findUnique: vi.fn(async () => request()),
        updateMany: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          updateData = data
          return { count: 1 }
        }),
        findUniqueOrThrow: vi.fn(async () => completed),
      },
      auditLog: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          auditData = data
        }),
      },
    }
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
    }

    await expect(service(prisma).transitionByOperator(
      requestId,
      DataRightsRequestStatus.completed,
      'operator-trace',
    )).resolves.toMatchObject({ status: 'completed', resolvedAt: now.toISOString() })
    expect(updateData).toMatchObject({
      status: DataRightsRequestStatus.completed,
      activeRequestKey: null,
      resolvedAt: expect.any(Date),
    })
    expect(auditData).toMatchObject({
      actorUserId: null,
      action: 'data_rights.request.status_changed',
      resourceId: requestId,
      requestId: 'operator-trace',
      metadata: { from: 'pending', to: 'completed' },
    })
  })

  it('rejects transitions from cancelled or terminal requests', async () => {
    const tx = {
      dataRightsRequest: {
        findUnique: vi.fn(async () => request({ status: DataRightsRequestStatus.cancelled })),
      },
    }
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
    }
    await expect(service(prisma).transitionByOperator(
      requestId,
      DataRightsRequestStatus.completed,
    )).rejects.toBeInstanceOf(ConflictException)
  })

  it.each([
    DataRightsRequestStatus.processing,
    DataRightsRequestStatus.completed,
    DataRightsRequestStatus.rejected,
  ])('rejects an operator replay to the current %s status', async (status) => {
    const tx = {
      dataRightsRequest: {
        findUnique: vi.fn(async () => request({ status })),
      },
    }
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
    }

    await expect(service(prisma).transitionByOperator(
      requestId,
      status as DataRightsOperatorTargetStatus,
    )).rejects.toBeInstanceOf(ConflictException)
  })
})

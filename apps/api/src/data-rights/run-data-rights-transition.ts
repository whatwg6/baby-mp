import { DataRightsRequestStatus } from '@prisma/client'
import { randomUUID } from 'node:crypto'

import { validateEnvironment } from '../config/environment'
import { PrismaService } from '../database/prisma.service'
import {
  DataRightsService,
  type DataRightsOperatorTargetStatus,
} from './data-rights.service'

const requestId = process.env.DATA_RIGHTS_REQUEST_ID?.trim()
const rawStatus = process.env.DATA_RIGHTS_TARGET_STATUS?.trim()
const confirmation = process.env.DATA_RIGHTS_OPERATOR_CONFIRM?.trim()
const allowedStatuses = new Set<string>([
  DataRightsRequestStatus.processing,
  DataRightsRequestStatus.completed,
  DataRightsRequestStatus.rejected,
])

async function main() {
  validateEnvironment(process.env)
  if (!requestId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
    throw new Error('DATA_RIGHTS_REQUEST_ID must be a UUID')
  }
  if (!rawStatus || !allowedStatuses.has(rawStatus)) {
    throw new Error('DATA_RIGHTS_TARGET_STATUS must be processing, completed, or rejected')
  }
  const targetStatus = rawStatus as DataRightsOperatorTargetStatus
  if (confirmation !== `${requestId}:${rawStatus}`) {
    throw new Error('DATA_RIGHTS_OPERATOR_CONFIRM must match <request-id>:<target-status>')
  }

  const prisma = new PrismaService()
  try {
    await prisma.$connect()
    const service = new DataRightsService(prisma)
    await service.transitionByOperator(
      requestId,
      targetStatus,
      `operator-${randomUUID()}`,
    )
    process.stdout.write(`Data-rights request status updated to ${targetStatus}.\n`)
  } finally {
    await prisma.$disconnect()
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Data-rights transition failed'}\n`)
  process.exitCode = 1
})

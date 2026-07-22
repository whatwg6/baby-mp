import { BadRequestException, ValidationPipe } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'

import type { RequestWithContext } from '../src/common/http/request-context'
import { DeleteRecordQueryDto } from '../src/records/record.dto'
import { RecordsController } from '../src/records/records.controller'
import type { RecordsService } from '../src/records/records.service'

const userId = '11111111-1111-4111-8111-111111111111'
const recordId = '55555555-5555-4555-8555-555555555555'

describe('RecordsController delete validation', () => {
  const pipe = new ValidationPipe({
    forbidNonWhitelisted: true,
    transform: true,
    whitelist: true,
  })

  it.each(['0', '-1'])('rejects version=%s before controller execution', async (version) => {
    await expect(pipe.transform(
      { version },
      { type: 'query', metatype: DeleteRecordQueryDto },
    )).rejects.toBeInstanceOf(BadRequestException)
  })

  it('transforms a valid version and passes it to the service', async () => {
    const query = await pipe.transform(
      { version: '2' },
      { type: 'query', metatype: DeleteRecordQueryDto },
    )
    const remove = vi.fn(async () => undefined)
    const controller = new RecordsController({ remove } as unknown as RecordsService)
    const request = { user: { id: userId } } as RequestWithContext

    await controller.remove(request, recordId, query)

    expect(query).toBeInstanceOf(DeleteRecordQueryDto)
    expect(remove).toHaveBeenCalledWith(userId, recordId, 2)
  })
})

import { Injectable } from '@nestjs/common'

import type { RequestWithContext } from '../common/http/request-context'
import type {
  BabyResourceContext,
  BabyResourceResolver,
} from '../families/authorization/baby-authorization.port'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

@Injectable()
export class RouteBabyResourceResolver implements BabyResourceResolver {
  async resolve(value: unknown): Promise<BabyResourceContext | null> {
    const request = value as RequestWithContext
    const babyId = request.params?.babyId
    return typeof babyId === 'string' && uuidPattern.test(babyId) ? { babyId } : null
  }
}

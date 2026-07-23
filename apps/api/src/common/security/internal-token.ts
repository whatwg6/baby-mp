import { timingSafeEqual } from 'node:crypto'

export const INTERNAL_TOKEN_HEADER = 'x-internal-monitoring-token'

export function matchesInternalToken(
  supplied: string | undefined,
  expected: string | undefined,
): boolean {
  if (!supplied || !expected) return false
  const suppliedBytes = Buffer.from(supplied)
  const expectedBytes = Buffer.from(expected)
  return (
    suppliedBytes.byteLength === expectedBytes.byteLength &&
    timingSafeEqual(suppliedBytes, expectedBytes)
  )
}

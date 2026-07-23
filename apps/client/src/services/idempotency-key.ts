function randomByte(): number {
  const cryptoApi = globalThis.crypto
  if (cryptoApi?.getRandomValues) {
    return cryptoApi.getRandomValues(new Uint8Array(1))[0]!
  }
  return Math.floor(Math.random() * 256)
}

export function createIdempotencyKey(): string {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID()
  }

  const bytes = Array.from({ length: 16 }, randomByte)
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const value = bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`
}

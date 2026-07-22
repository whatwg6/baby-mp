const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < table.length; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[index] = value >>> 0
  }
  return table
})()

export interface ZipEntry {
  name: string
  source: () => AsyncIterable<Uint8Array>
}

interface CentralEntry {
  name: Buffer
  checksum: number
  size: number
  offset: number
  time: number
  date: number
}

export class ExportArchiveTooLargeError extends Error {
  constructor() { super('Export archive exceeds its configured limit') }
}

function updateCrc(crc: number, data: Uint8Array): number {
  let value = crc
  for (const byte of data) value = CRC_TABLE[(value ^ byte) & 0xff]! ^ (value >>> 8)
  return value
}

function dosDateTime(value: Date): { time: number; date: number } {
  const year = Math.max(1980, Math.min(2107, value.getUTCFullYear()))
  return {
    time: (value.getUTCHours() << 11) | (value.getUTCMinutes() << 5) | Math.floor(value.getUTCSeconds() / 2),
    date: ((year - 1980) << 9) | ((value.getUTCMonth() + 1) << 5) | value.getUTCDate(),
  }
}

function assertSafeEntryName(name: string): Buffer {
  if (!name || name.startsWith('/') || name.includes('\\') || name.split('/').some((part) => part === '..' || part === '')) {
    throw new Error('Unsafe ZIP entry name')
  }
  const encoded = Buffer.from(name, 'utf8')
  if (encoded.byteLength > 65_535) throw new Error('ZIP entry name is too long')
  return encoded
}

function localHeader(name: Buffer, time: number, date: number): Buffer {
  const header = Buffer.alloc(30 + name.byteLength)
  header.writeUInt32LE(0x04034b50, 0)
  header.writeUInt16LE(20, 4)
  header.writeUInt16LE(0x0808, 6)
  header.writeUInt16LE(0, 8)
  header.writeUInt16LE(time, 10)
  header.writeUInt16LE(date, 12)
  header.writeUInt16LE(name.byteLength, 26)
  name.copy(header, 30)
  return header
}

function dataDescriptor(checksum: number, size: number): Buffer {
  const descriptor = Buffer.alloc(16)
  descriptor.writeUInt32LE(0x08074b50, 0)
  descriptor.writeUInt32LE(checksum >>> 0, 4)
  descriptor.writeUInt32LE(size, 8)
  descriptor.writeUInt32LE(size, 12)
  return descriptor
}

function centralHeader(entry: CentralEntry): Buffer {
  const header = Buffer.alloc(46 + entry.name.byteLength)
  header.writeUInt32LE(0x02014b50, 0)
  header.writeUInt16LE(0x0314, 4)
  header.writeUInt16LE(20, 6)
  header.writeUInt16LE(0x0808, 8)
  header.writeUInt16LE(0, 10)
  header.writeUInt16LE(entry.time, 12)
  header.writeUInt16LE(entry.date, 14)
  header.writeUInt32LE(entry.checksum >>> 0, 16)
  header.writeUInt32LE(entry.size, 20)
  header.writeUInt32LE(entry.size, 24)
  header.writeUInt16LE(entry.name.byteLength, 28)
  // The archive declares Unix as its creator, so an explicit regular-file
  // mode is required; zero attributes make extracted files unreadable.
  header.writeUInt32LE((0o100644 << 16) >>> 0, 38)
  header.writeUInt32LE(entry.offset, 42)
  entry.name.copy(header, 46)
  return header
}

function endOfCentralDirectory(count: number, size: number, offset: number): Buffer {
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(count, 8)
  end.writeUInt16LE(count, 10)
  end.writeUInt32LE(size, 12)
  end.writeUInt32LE(offset, 16)
  return end
}

export async function* createZipStream(
  entries: readonly ZipEntry[],
  generatedAt: Date,
  maximumUncompressedBytes = 2 * 1024 * 1024 * 1024,
): AsyncGenerator<Uint8Array> {
  if (entries.length > 65_535) throw new ExportArchiveTooLargeError()
  const timestamp = dosDateTime(generatedAt)
  const central: CentralEntry[] = []
  let offset = 0
  let totalUncompressed = 0

  for (const entry of entries) {
    const name = assertSafeEntryName(entry.name)
    const header = localHeader(name, timestamp.time, timestamp.date)
    const entryOffset = offset
    yield header
    offset += header.byteLength
    let checksum = 0xffffffff
    let size = 0
    for await (const value of entry.source()) {
      const chunk = Buffer.from(value)
      if (chunk.byteLength === 0) continue
      size += chunk.byteLength
      totalUncompressed += chunk.byteLength
      if (size > 0xffffffff || totalUncompressed > maximumUncompressedBytes) {
        throw new ExportArchiveTooLargeError()
      }
      checksum = updateCrc(checksum, chunk)
      yield chunk
      offset += chunk.byteLength
    }
    checksum = (checksum ^ 0xffffffff) >>> 0
    const descriptor = dataDescriptor(checksum, size)
    yield descriptor
    offset += descriptor.byteLength
    central.push({ name, checksum, size, offset: entryOffset, ...timestamp })
  }

  const centralOffset = offset
  for (const entry of central) {
    const header = centralHeader(entry)
    yield header
    offset += header.byteLength
  }
  const centralSize = offset - centralOffset
  if (offset > 0xffffffff) throw new ExportArchiveTooLargeError()
  yield endOfCentralDirectory(central.length, centralSize, centralOffset)
}

export async function* bytesSource(value: string | Uint8Array): AsyncGenerator<Uint8Array> {
  yield typeof value === 'string' ? Buffer.from(value, 'utf8') : value
}

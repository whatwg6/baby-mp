import { describe, expect, it } from 'vitest'

import {
  buildExportFiles,
  csvFile,
  type ExportSnapshot,
} from '../src/exports/export-format'
import { bytesSource, createZipStream } from '../src/exports/zip-stream'

const exportId = '11111111-1111-4111-8111-111111111111'
const babyId = '22222222-2222-4222-8222-222222222222'
const recordId = '33333333-3333-4333-8333-333333333333'
const mediaId = '44444444-4444-4444-8444-444444444444'
const generatedAt = new Date('2026-07-17T01:02:03.000Z')

function snapshot(): ExportSnapshot {
  return {
    baby: {
      id: babyId, name: '=WEBSERVICE("bad")', gender: 'unspecified',
      birthDate: '2025-01-01', birthTime: null, birthHeightCm: null,
      birthWeightKg: null, createdAt: generatedAt.toISOString(),
      updatedAt: generatedAt.toISOString(), avatarMediaId: null,
    },
    avatarMedia: null,
    records: [{
      id: recordId, type: 'measurement', title: null, content: 'line 1, "quoted"\nline 2',
      occurredAt: generatedAt.toISOString(), createdAt: generatedAt.toISOString(),
      updatedAt: generatedAt.toISOString(), version: 1,
      createdBy: { id: '55555555-5555-4555-8555-555555555555', displayName: '@SUM(1,1)' },
      measurement: { heightCm: 68.2, weightKg: 7.85 },
      media: [{
        id: mediaId, mimeType: 'image/jpeg', sizeBytes: 3, width: 10, height: 20,
        sortOrder: 0, objectKey: 'media/secret-object-key.jpg',
      }],
    }],
  }
}

describe('M6 export JSON and CSV safety', () => {
  it('keeps canonical JSON lossless while neutralizing formulas in UTF-8 RFC4180 CSV', () => {
    const files = buildExportFiles(exportId, generatedAt, false, snapshot())
    expect(files.babyCsv.startsWith('\ufeff')).toBe(true)
    expect(files.babyCsv).toContain("'=WEBSERVICE")
    expect(files.recordsCsv).toContain("'@SUM")
    expect(files.recordsCsv).toContain('"line 1, ""quoted""\nline 2"')
    expect(files.canonical).toContain('=WEBSERVICE')
    expect(files.canonical).not.toContain('secret-object-key')
    expect(files.manifest).not.toContain('secret-object-key')
  })

  it('retains a media manifest without binary archive paths when photos are excluded', () => {
    const files = buildExportFiles(exportId, generatedAt, false, snapshot())
    expect(files.safeMedia).toEqual([expect.objectContaining({
      id: mediaId, recordId, included: false, archivePath: null,
    })])
    expect(files.mediaCsv).toContain('"false",""')
  })

  it('deduplicates binary paths while preserving every record-media association', () => {
    const value = snapshot()
    value.records.push({ ...value.records[0]!, id: '66666666-6666-4666-8666-666666666666' })
    const files = buildExportFiles(exportId, generatedAt, true, value)
    expect(files.safeMedia).toHaveLength(2)
    expect(new Set(files.safeMedia.map((item) => item.archivePath))).toHaveLength(1)
    expect(files.safeMedia.every((item) => item.included)).toBe(true)
  })

  it('always quotes CSV cells and terminates rows with CRLF', () => {
    expect(csvFile([['a', 'b'], ['+x', 'comma,value']])).toBe(
      '\ufeff"a","b"\r\n"\'+x","comma,value"\r\n',
    )
  })
})

describe('M6 streaming ZIP', () => {
  it('writes a standard non-ZIP64 archive with UTF-8 names and data descriptors', async () => {
    const chunks: Uint8Array[] = []
    for await (const chunk of createZipStream([
      { name: 'manifest.json', source: () => bytesSource('{"ok":true}\n') },
      { name: 'csv/记录.csv', source: () => bytesSource('a,b\r\n') },
    ], generatedAt)) chunks.push(chunk)
    const archive = Buffer.concat(chunks)
    expect(archive.readUInt32LE(0)).toBe(0x04034b50)
    expect(archive.includes(Buffer.from('manifest.json'))).toBe(true)
    expect(archive.includes(Buffer.from('csv/记录.csv'))).toBe(true)
    expect(archive.readUInt32LE(archive.byteLength - 22)).toBe(0x06054b50)
    expect(archive.readUInt16LE(archive.byteLength - 14)).toBe(2)
    const centralOffset = archive.readUInt32LE(archive.byteLength - 6)
    expect(archive.readUInt32LE(centralOffset)).toBe(0x02014b50)
    expect(archive.readUInt32LE(centralOffset + 38) >>> 16).toBe(0o100644)
  })

  it('rejects traversal paths before yielding user data', async () => {
    const consume = async () => {
      for await (const chunk of createZipStream([
        { name: '../secret', source: () => bytesSource('bad') },
      ], generatedAt)) void chunk
    }
    await expect(consume()).rejects.toThrow('Unsafe ZIP entry name')
  })
})

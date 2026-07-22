export const EXPORT_SCHEMA_VERSION = 1

const FORMULA_PREFIX = /^\s*[=+\-@]/

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '""'
  let text = value instanceof Date ? value.toISOString() : String(value)
  if (FORMULA_PREFIX.test(text)) text = `'${text}`
  return `"${text.replaceAll('"', '""')}"`
}

export function csvFile(rows: readonly (readonly unknown[])[]): string {
  return `\ufeff${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`
}

export interface ExportSnapshot {
  baby: {
    id: string
    name: string
    gender: string
    birthDate: string
    birthTime: string | null
    birthHeightCm: number | null
    birthWeightKg: number | null
    createdAt: string
    updatedAt: string
    avatarMediaId: string | null
  }
  records: Array<{
    id: string
    type: string
    title: string | null
    content: string | null
    occurredAt: string
    createdAt: string
    updatedAt: string
    version: number
    createdBy: { id: string; displayName: string | null }
    measurement: { heightCm: number | null; weightKg: number | null } | null
    media: Array<{
      id: string
      mimeType: string
      sizeBytes: number
      width: number | null
      height: number | null
      sortOrder: number
      objectKey: string
    }>
  }>
  avatarMedia: {
    id: string
    mimeType: string
    sizeBytes: number
    width: number | null
    height: number | null
    objectKey: string
  } | null
}

export interface SafeMediaReference {
  id: string
  recordId: string | null
  use: 'record' | 'baby_avatar'
  sortOrder: number | null
  mimeType: string
  sizeBytes: number
  width: number | null
  height: number | null
  included: boolean
  archivePath: string | null
}

export function extensionFor(mimeType: string): 'jpg' | 'png' {
  if (mimeType === 'image/jpeg') return 'jpg'
  if (mimeType === 'image/png') return 'png'
  throw new Error('Unsupported source media type')
}

export function safeMediaReferences(
  snapshot: ExportSnapshot,
  includeMedia: boolean,
): SafeMediaReference[] {
  const references: SafeMediaReference[] = []
  if (snapshot.avatarMedia) {
    const media = snapshot.avatarMedia
    references.push({
      id: media.id,
      recordId: null,
      use: 'baby_avatar',
      sortOrder: null,
      mimeType: media.mimeType,
      sizeBytes: media.sizeBytes,
      width: media.width,
      height: media.height,
      included: includeMedia,
      archivePath: includeMedia ? `media/${media.id}.${extensionFor(media.mimeType)}` : null,
    })
  }
  for (const record of snapshot.records) {
    for (const media of record.media) {
      references.push({
        id: media.id,
        recordId: record.id,
        use: 'record',
        sortOrder: media.sortOrder,
        mimeType: media.mimeType,
        sizeBytes: media.sizeBytes,
        width: media.width,
        height: media.height,
        included: includeMedia,
        archivePath: includeMedia ? `media/${media.id}.${extensionFor(media.mimeType)}` : null,
      })
    }
  }
  return references
}

export function buildExportFiles(
  exportId: string,
  generatedAt: Date,
  includeMedia: boolean,
  snapshot: ExportSnapshot,
) {
  const media = safeMediaReferences(snapshot, includeMedia)
  const safeRecords = snapshot.records.map((record) => ({
    id: record.id,
    type: record.type,
    title: record.title,
    content: record.content,
    occurredAt: record.occurredAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    version: record.version,
    createdBy: record.createdBy,
    measurement: record.measurement,
    media: media.filter((item) => item.recordId === record.id),
  }))
  const safeBaby = { ...snapshot.baby, avatarMediaId: snapshot.baby.avatarMediaId }
  const uniqueIncludedMedia = new Set(media.filter((item) => item.included).map((item) => item.id))
  const manifest = {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    exportId,
    generatedAt: generatedAt.toISOString(),
    format: 'zip',
    includeMedia,
    representations: ['json', 'csv'],
    counts: {
      records: safeRecords.length,
      measurements: safeRecords.filter((record) => record.measurement !== null).length,
      mediaReferences: media.length,
      includedMedia: uniqueIncludedMedia.size,
    },
    files: ['json/export.json', 'csv/baby.csv', 'csv/records.csv', 'csv/measurements.csv', 'csv/media.csv'],
  }
  const canonical = {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    generatedAt: generatedAt.toISOString(),
    baby: safeBaby,
    records: safeRecords,
    media,
  }

  return {
    manifest: `${JSON.stringify(manifest, null, 2)}\n`,
    canonical: `${JSON.stringify(canonical, null, 2)}\n`,
    babyCsv: csvFile([
      ['id', 'name', 'gender', 'birthDate', 'birthTime', 'birthHeightCm', 'birthWeightKg', 'createdAt', 'updatedAt', 'avatarMediaId'],
      [safeBaby.id, safeBaby.name, safeBaby.gender, safeBaby.birthDate, safeBaby.birthTime, safeBaby.birthHeightCm, safeBaby.birthWeightKg, safeBaby.createdAt, safeBaby.updatedAt, safeBaby.avatarMediaId],
    ]),
    recordsCsv: csvFile([
      ['id', 'type', 'title', 'content', 'occurredAt', 'createdById', 'createdByDisplayName', 'createdAt', 'updatedAt'],
      ...safeRecords.map((record) => [record.id, record.type, record.title, record.content, record.occurredAt, record.createdBy.id, record.createdBy.displayName, record.createdAt, record.updatedAt]),
    ]),
    measurementsCsv: csvFile([
      ['recordId', 'occurredAt', 'heightCm', 'weightKg', 'note'],
      ...safeRecords.filter((record) => record.measurement).map((record) => [record.id, record.occurredAt, record.measurement!.heightCm, record.measurement!.weightKg, record.content]),
    ]),
    mediaCsv: csvFile([
      ['mediaId', 'recordId', 'use', 'sortOrder', 'mimeType', 'sizeBytes', 'width', 'height', 'included', 'archivePath'],
      ...media.map((item) => [item.id, item.recordId, item.use, item.sortOrder, item.mimeType, item.sizeBytes, item.width, item.height, item.included, item.archivePath]),
    ]),
    safeMedia: media,
  }
}

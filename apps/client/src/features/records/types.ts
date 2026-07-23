import type { Record as ContractRecord } from '@baby-mp/contracts'

export type RecordType = 'note' | 'measurement' | 'milestone'

export type GrowthRecord = ContractRecord

export interface TimelinePage {
  data: GrowthRecord[]
  meta: { nextCursor: string | null }
}

export interface RecordDraftInput {
  type: RecordType
  title?: string
  content?: string | null
  occurredAt: string
  measurement?: { heightCm?: number | null; weightKg?: number | null }
  mediaIds: string[]
}

export interface RecordFormValues {
  type: RecordType
  title: string
  content: string
  heightCm: string
  weightKg: string
  occurredAt: string
}

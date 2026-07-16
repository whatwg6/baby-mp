import type { Baby as ContractBaby } from '@baby-mp/contracts'

export type Baby = ContractBaby
export type BabyRole = Baby['role']
export type BabyGender = Baby['gender']

export interface BabyInput {
  name: string
  gender: BabyGender
  birthDate: string
  birthTime?: string | null
  birthHeightCm?: number | null
  birthWeightKg?: number | null
}

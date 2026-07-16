import type { BabyGender, BabyInput } from './types'

export interface BabyFormValues {
  name: string
  gender: BabyGender
  birthDate: string
  birthTime: string
  birthHeightCm: string
  birthWeightKg: string
}

export type BabyFormErrors = Partial<Record<keyof BabyFormValues, string>>

function validDecimal(value: string, decimalPlaces: number) {
  return new RegExp(`^\\d+(?:\\.\\d{1,${decimalPlaces}})?$`).test(value)
}

export function validateBabyForm(values: BabyFormValues, today: string): BabyFormErrors {
  const errors: BabyFormErrors = {}
  const name = values.name.trim()
  if (!name) errors.name = '请输入宝宝昵称'
  else if ([...name].length > 40) errors.name = '昵称不能超过 40 个字符'

  if (!values.birthDate) errors.birthDate = '请选择出生日期'
  else if (values.birthDate > today) errors.birthDate = '出生日期不能晚于今天'

  if (values.birthTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(values.birthTime)) {
    errors.birthTime = '出生时间格式不正确'
  }

  if (values.birthHeightCm) {
    const height = Number(values.birthHeightCm)
    if (!validDecimal(values.birthHeightCm, 2) || height < 20 || height > 250) {
      errors.birthHeightCm = '身高需为 20–250 cm，最多两位小数'
    }
  }
  if (values.birthWeightKg) {
    const weight = Number(values.birthWeightKg)
    if (!validDecimal(values.birthWeightKg, 3) || weight < 0.2 || weight > 300) {
      errors.birthWeightKg = '体重需为 0.2–300 kg，最多三位小数'
    }
  }
  return errors
}

export function toBabyInput(values: BabyFormValues): BabyInput {
  return {
    name: values.name.trim(), gender: values.gender, birthDate: values.birthDate,
    birthTime: values.birthTime || null,
    birthHeightCm: values.birthHeightCm ? Number(values.birthHeightCm) : null,
    birthWeightKg: values.birthWeightKg ? Number(values.birthWeightKg) : null,
  }
}

export function formatLocalDate(date = new Date()) {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function formatBabyAge(birthDate: string, now = new Date()): string {
  const [year = now.getFullYear(), month = now.getMonth() + 1, day = now.getDate()] = birthDate.split('-').map(Number)
  let months = (now.getFullYear() - year) * 12 + now.getMonth() - (month - 1)
  if (now.getDate() < day) months -= 1
  months = Math.max(0, months)
  if (months < 24) return `${months} 个月`
  return `${Math.floor(months / 12)} 岁${months % 12 ? ` ${months % 12} 个月` : ''}`
}

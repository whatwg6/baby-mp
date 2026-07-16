import { Button, Input, Picker, Text, View } from '@tarojs/components'
import { useMemo, useState } from 'react'

import type { BabyGender } from './types'
import {
  formatLocalDate, toBabyInput, validateBabyForm,
  type BabyFormErrors, type BabyFormValues,
} from './validation'

import './baby-form.scss'

const genderOptions: Array<{ label: string; value: BabyGender }> = [
  { label: '男', value: 'male' }, { label: '女', value: 'female' }, { label: '暂不设置', value: 'unspecified' },
]

export interface BabyFormProps {
  initialValues?: Partial<BabyFormValues>
  submitLabel: string
  loading?: boolean
  error?: string
  onSubmit: (input: ReturnType<typeof toBabyInput>) => Promise<void>
}

const blankValues: BabyFormValues = {
  name: '', gender: 'unspecified', birthDate: '', birthTime: '', birthHeightCm: '', birthWeightKg: '',
}

export function BabyForm({ initialValues, submitLabel, loading = false, error, onSubmit }: BabyFormProps) {
  const [values, setValues] = useState<BabyFormValues>({ ...blankValues, ...initialValues })
  const [errors, setErrors] = useState<BabyFormErrors>({})
  const today = useMemo(() => formatLocalDate(), [])

  const update = <K extends keyof BabyFormValues>(key: K, value: BabyFormValues[K]) => {
    setValues((current) => ({ ...current, [key]: value }))
    setErrors((current) => ({ ...current, [key]: undefined }))
  }

  const submit = async () => {
    const nextErrors = validateBabyForm(values, today)
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0 || loading) return
    await onSubmit(toBabyInput(values))
  }

  return (
    <View className="baby-form">
      <View className="baby-form__avatar">宝</View>
      <View className="form-field">
        <Text className="form-field__label">宝宝昵称 *</Text>
        <Input value={values.name} maxlength={40} placeholder="请输入昵称" onInput={(event) => update('name', event.detail.value)} />
        {errors.name ? <Text className="form-field__error">{errors.name}</Text> : null}
      </View>
      <View className="form-field">
        <Text className="form-field__label">性别</Text>
        <View className="gender-options">
          {genderOptions.map((option) => (
            <Button key={option.value} className={values.gender === option.value ? 'is-selected' : ''}
              onClick={() => update('gender', option.value)}>{option.label}</Button>
          ))}
        </View>
      </View>
      <View className="form-field">
        <Text className="form-field__label">出生日期 *</Text>
        <Picker mode="date" end={today} value={values.birthDate || today}
          onChange={(event) => update('birthDate', String(event.detail.value))}>
          <View className={`picker-value${values.birthDate ? '' : ' is-placeholder'}`}>
            {values.birthDate || '请选择出生日期'}
          </View>
        </Picker>
        {errors.birthDate ? <Text className="form-field__error">{errors.birthDate}</Text> : null}
      </View>
      <View className="form-field">
        <Text className="form-field__label">出生时间（选填）</Text>
        <Picker mode="time" value={values.birthTime || '08:00'} onChange={(event) => update('birthTime', String(event.detail.value))}>
          <View className={`picker-value${values.birthTime ? '' : ' is-placeholder'}`}>{values.birthTime || '请选择出生时间'}</View>
        </Picker>
        {values.birthTime ? <Button className="link-button" onClick={() => update('birthTime', '')}>清除时间</Button> : null}
      </View>
      <View className="form-row">
        <View className="form-field">
          <Text className="form-field__label">出生身高（cm）</Text>
          <Input type="digit" value={values.birthHeightCm} placeholder="如 50.2"
            onInput={(event) => update('birthHeightCm', event.detail.value)} />
          {errors.birthHeightCm ? <Text className="form-field__error">{errors.birthHeightCm}</Text> : null}
        </View>
        <View className="form-field">
          <Text className="form-field__label">出生体重（kg）</Text>
          <Input type="digit" value={values.birthWeightKg} placeholder="如 3.42"
            onInput={(event) => update('birthWeightKg', event.detail.value)} />
          {errors.birthWeightKg ? <Text className="form-field__error">{errors.birthWeightKg}</Text> : null}
        </View>
      </View>
      {error ? <Text className="form-submit-error">{error}</Text> : null}
      <Button className="primary-button" loading={loading} disabled={loading} onClick={() => void submit()}>{submitLabel}</Button>
    </View>
  )
}

import { Button, Image, Input, Picker, Text, View } from '@tarojs/components'
import { useMemo, useState } from 'react'

import type { BabyGender } from './types'
import { chooseMediaDrafts } from '../media/upload'
import type { MediaDraft } from '../media/types'
import { platform } from '../../platform'
import {
  firstBabyFormErrorField, formatLocalDate, toBabyInput, validateBabyForm,
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
  avatar?: MediaDraft
  avatarUrl?: string | null
  onAvatarChange?: (avatar?: MediaDraft) => void
  onDirtyChange?: (dirty: boolean) => void
  onSubmit: (input: ReturnType<typeof toBabyInput>) => Promise<void>
}

const blankValues: BabyFormValues = {
  name: '', gender: 'unspecified', birthDate: '', birthTime: '', birthHeightCm: '', birthWeightKg: '',
}

export function BabyForm({
  initialValues,
  submitLabel,
  loading = false,
  error,
  avatar,
  avatarUrl,
  onAvatarChange,
  onDirtyChange,
  onSubmit,
}: BabyFormProps) {
  const [values, setValues] = useState<BabyFormValues>({ ...blankValues, ...initialValues })
  const [errors, setErrors] = useState<BabyFormErrors>({})
  const [focusedField, setFocusedField] = useState<keyof BabyFormValues>()
  const today = useMemo(() => formatLocalDate(), [])

  const update = <K extends keyof BabyFormValues>(key: K, value: BabyFormValues[K]) => {
    setValues((current) => ({ ...current, [key]: value }))
    setErrors((current) => ({ ...current, [key]: undefined }))
    setFocusedField((current) => current === key ? undefined : current)
    onDirtyChange?.(true)
  }

  const submit = async () => {
    const nextErrors = validateBabyForm(values, today)
    setErrors(nextErrors)
    const firstError = firstBabyFormErrorField(nextErrors)
    if (firstError) {
      setFocusedField(firstError)
      void platform.scrollToElement(`#baby-field-${firstError}`)
      return
    }
    if (loading) return
    await onSubmit(toBabyInput(values))
  }

  const chooseAvatar = async () => {
    try {
      const [selected] = await chooseMediaDrafts(1)
      if (selected) {
        onAvatarChange?.(selected)
        onDirtyChange?.(true)
      }
    } catch (reason) {
      await platform.showToast(reason instanceof Error ? reason.message : '选择头像失败')
    }
  }

  const avatarSource = avatar?.localPath || avatar?.accessUrl || avatarUrl

  return (
    <View className="baby-form">
      <View className="baby-form__avatar-field">
        {avatarSource
          ? <Image className="baby-form__avatar" src={avatarSource} mode="aspectFill" lazyLoad />
          : <View className="baby-form__avatar baby-form__avatar--fallback">宝</View>}
        <Button className="link-button baby-form__avatar-action" disabled={loading}
          onClick={() => void chooseAvatar()}>
          {avatarSource ? '更换头像' : '选择头像（选填）'}
        </Button>
        {avatar?.state === 'compressing' ? <Text className="baby-form__avatar-status">正在压缩头像…</Text> : null}
        {avatar?.state === 'uploading' ? <Text className="baby-form__avatar-status">头像上传 {avatar.progress > 0 ? `${avatar.progress}%` : '中…'}</Text> : null}
        {avatar?.state === 'failed' ? <Text className="form-field__error">{avatar.error ?? '头像上传失败，可重试'}</Text> : null}
      </View>
      <View className="form-field" id="baby-field-name">
        <Text className="form-field__label">宝宝昵称 *</Text>
        <Input focus={focusedField === 'name'} value={values.name} maxlength={40} placeholder="请输入昵称" onInput={(event) => update('name', event.detail.value)} />
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
      <View className="form-field" id="baby-field-birthDate">
        <Text className="form-field__label">出生日期 *</Text>
        <Picker mode="date" end={today} value={values.birthDate || today}
          onChange={(event) => update('birthDate', String(event.detail.value))}>
          <View className={`picker-value${values.birthDate ? '' : ' is-placeholder'}`}>
            {values.birthDate || '请选择出生日期'}
          </View>
        </Picker>
        {errors.birthDate ? <Text className="form-field__error">{errors.birthDate}</Text> : null}
      </View>
      <View className="form-field" id="baby-field-birthTime">
        <Text className="form-field__label">出生时间（选填）</Text>
        <Picker mode="time" value={values.birthTime || '08:00'} onChange={(event) => update('birthTime', String(event.detail.value))}>
          <View className={`picker-value${values.birthTime ? '' : ' is-placeholder'}`}>{values.birthTime || '请选择出生时间'}</View>
        </Picker>
        {values.birthTime ? <Button className="link-button" onClick={() => update('birthTime', '')}>清除时间</Button> : null}
        {errors.birthTime ? <Text className="form-field__error">{errors.birthTime}</Text> : null}
      </View>
      <View className="form-row">
        <View className="form-field" id="baby-field-birthHeightCm">
          <Text className="form-field__label">出生身高（cm）</Text>
          <Input focus={focusedField === 'birthHeightCm'} type="digit" value={values.birthHeightCm} placeholder="如 50.2"
            onInput={(event) => update('birthHeightCm', event.detail.value)} />
          {errors.birthHeightCm ? <Text className="form-field__error">{errors.birthHeightCm}</Text> : null}
        </View>
        <View className="form-field" id="baby-field-birthWeightKg">
          <Text className="form-field__label">出生体重（kg）</Text>
          <Input focus={focusedField === 'birthWeightKg'} type="digit" value={values.birthWeightKg} placeholder="如 3.42"
            onInput={(event) => update('birthWeightKg', event.detail.value)} />
          {errors.birthWeightKg ? <Text className="form-field__error">{errors.birthWeightKg}</Text> : null}
        </View>
      </View>
      {error ? <Text className="form-submit-error">{error}</Text> : null}
      <Button className="primary-button" loading={loading} disabled={loading} onClick={() => void submit()}>{submitLabel}</Button>
    </View>
  )
}

import { Button, Text, View } from '@tarojs/components'

import './index.scss'

export interface ConfirmDialogProps {
  open: boolean
  title: string
  description: string
  confirmLabel: string
  cancelLabel: string
  danger?: boolean
  loading?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  danger = false,
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  if (!open) return null

  return (
    <View className="confirm-dialog">
      <View className="confirm-dialog__panel">
        <Text className="confirm-dialog__title">{title}</Text>
        <Text className="confirm-dialog__description">{description}</Text>
        <View className="confirm-dialog__actions">
          <Button className="confirm-dialog__cancel" onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button
            className={`confirm-dialog__confirm${danger ? ' confirm-dialog__confirm--danger' : ''}`}
            onClick={onConfirm}
            loading={loading}
            disabled={loading}
          >
            {confirmLabel}
          </Button>
        </View>
      </View>
    </View>
  )
}

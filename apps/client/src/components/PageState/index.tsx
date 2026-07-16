import { Button, Text, View } from '@tarojs/components'

import './index.scss'

export type PageStateKind = 'loading' | 'empty' | 'error' | 'forbidden'

export interface PageStateProps {
  kind: PageStateKind
  title?: string
  description?: string
  actionLabel?: string
  onAction?: () => void
}

const defaults: Record<PageStateKind, { title: string; description: string; symbol: string }> = {
  loading: { title: '正在加载', description: '请稍候片刻', symbol: '···' },
  empty: { title: '这里还没有内容', description: '完成下一步后，内容会显示在这里', symbol: '○' },
  error: { title: '加载失败', description: '网络可能开了小差，请稍后重试', symbol: '!' },
  forbidden: { title: '暂时无法查看', description: '你的权限可能已经发生变化', symbol: '—' },
}

export function PageState({
  kind,
  title = defaults[kind].title,
  description = defaults[kind].description,
  actionLabel,
  onAction,
}: PageStateProps) {
  return (
    <View className={`page-state page-state--${kind}`}>
      <View className="page-state__symbol">
        {defaults[kind].symbol}
      </View>
      <Text className="page-state__title">{title}</Text>
      <Text className="page-state__description">{description}</Text>
      {actionLabel && onAction ? (
        <Button className="page-state__action" onClick={onAction} loading={kind === 'loading'}>
          {actionLabel}
        </Button>
      ) : null}
    </View>
  )
}

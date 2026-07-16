import { Button, Image, Text, View } from '@tarojs/components'

import { platform } from '../../platform'
import { chooseMediaDrafts, mediaPlatform } from './upload'
import type { MediaDraft } from './types'

import './media-picker.scss'

interface MediaPickerProps {
  items: MediaDraft[]
  disabled?: boolean
  onChange: (items: MediaDraft[]) => void
  onRetry: (item: MediaDraft) => void
}

export function MediaPicker({ items, disabled = false, onChange, onRetry }: MediaPickerProps) {
  const add = async () => {
    try {
      const selected = await chooseMediaDrafts(9 - items.length)
      onChange([...items, ...selected])
    } catch (error) {
      await platform.showToast(error instanceof Error ? error.message : '选择图片失败')
    }
  }

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction
    if (target < 0 || target >= items.length) return
    const next = [...items]
    const current = next[index]
    const destination = next[target]
    if (!current || !destination) return
    next[index] = destination
    next[target] = current
    onChange(next)
  }

  const preview = (item: MediaDraft) => {
    const urls = items.map((entry) => entry.accessUrl || entry.localPath).filter((url): url is string => Boolean(url))
    const current = item.accessUrl || item.localPath
    if (mediaPlatform.previewImages && current) void mediaPlatform.previewImages(urls, current)
  }

  return <View className="media-picker">
    <View className="media-picker__header">
      <Text className="form-label">照片（最多 9 张）</Text>
      <Text className="media-picker__count">{items.length}/9</Text>
    </View>
    <View className="media-picker__grid">
      {items.map((item, index) => <View className="media-picker__item" key={item.localId}>
        <Image className="media-picker__image" src={item.accessUrl || item.localPath || ''} mode="aspectFill" onClick={() => preview(item)} />
        {item.state === 'uploading' || item.state === 'compressing' ? <View className="media-picker__status"><Text>{item.state === 'compressing' ? '压缩中' : `${item.progress}%`}</Text></View> : null}
        {item.state === 'failed' ? <View className="media-picker__status media-picker__status--error"><Text>上传失败</Text></View> : null}
        <View className="media-picker__actions">
          <Button size="mini" disabled={disabled || index === 0} onClick={() => move(index, -1)}>←</Button>
          <Button size="mini" disabled={disabled || index === items.length - 1} onClick={() => move(index, 1)}>→</Button>
          <Button size="mini" disabled={disabled} onClick={() => onChange(items.filter((entry) => entry.localId !== item.localId))}>删</Button>
        </View>
        {item.state === 'failed' ? <Button className="media-picker__retry" size="mini" disabled={disabled} onClick={() => onRetry(item)}>重试</Button> : null}
      </View>)}
      {items.length < 9 ? <Button className="media-picker__add" disabled={disabled} onClick={() => void add()}>＋<Text>选择照片</Text></Button> : null}
    </View>
  </View>
}

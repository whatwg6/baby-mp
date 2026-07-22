import { Button, Image, Text, View } from '@tarojs/components'

import { platform } from '../../platform'
import { selectBaby, useBabyState } from './store'

import './baby-switcher.scss'

const roleLabels = { admin: '管理员', editor: '可编辑成员', viewer: '只读成员' }

export interface BabySwitcherProps {
  open: boolean
  currentId?: string
  onClose: () => void
}

export function BabySwitcher({ open, currentId, onClose }: BabySwitcherProps) {
  const state = useBabyState()
  if (!open) return null

  const choose = async (id: string) => {
    await selectBaby(id)
    onClose()
  }

  return <View className="baby-switcher__overlay" onClick={onClose}>
    <View className="baby-switcher" onClick={(event) => event.stopPropagation()}>
      <Text className="baby-switcher__title">切换宝宝</Text>
      {state.babies.map((baby) => <View
        className={`baby-switcher__item${baby.id === currentId ? ' is-current' : ''}`}
        key={baby.id}
        onClick={() => void choose(baby.id)}
      >
        {baby.avatarUrl
          ? <Image className="baby-switcher__avatar" src={baby.avatarUrl} mode="aspectFill" lazyLoad />
          : <View className="baby-switcher__avatar baby-switcher__avatar--fallback">宝</View>}
        <View className="baby-switcher__body">
          <Text className="baby-switcher__name">{baby.name}</Text>
          <Text className="baby-switcher__role">{roleLabels[baby.role]}</Text>
        </View>
        <Text className="baby-switcher__check">{baby.id === currentId ? '✓' : ''}</Text>
      </View>)}
      <Button className="secondary-button" onClick={() => {
        onClose()
        void platform.navigateTo('/pages/babies/create')
      }}>创建宝宝</Button>
      <Button className="link-button" onClick={() => {
        onClose()
        void platform.navigateTo('/pages/babies/index')
      }}>管理宝宝档案</Button>
    </View>
  </View>
}

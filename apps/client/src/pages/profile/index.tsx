import { Button, Text, View } from '@tarojs/components'
import { useState } from 'react'

import { ConfirmDialog } from '../../components/ConfirmDialog'
import { useProtectedPage } from '../../features/auth/use-protected-page'
import { logout, useAuthState } from '../../features/auth/store'
import { clearBabies, useBabyState } from '../../features/babies/store'
import { platform } from '../../platform'

export default function ProfilePage() {
  useProtectedPage()
  const auth = useAuthState()
  const babies = useBabyState()
  const [confirming, setConfirming] = useState(false)
  const [loading, setLoading] = useState(false)

  const performLogout = async () => {
    setLoading(true)
    try { await logout() } finally {
      clearBabies(); setLoading(false); setConfirming(false)
      await platform.reLaunch('/pages/auth/index')
    }
  }
  return <View className="page-shell"><View className="page-heading"><Text className="page-title">我的</Text>
    <Text className="page-description">管理宝宝档案、家庭成员与隐私设置。</Text></View>
    <View className="surface-card profile-user"><Text className="list-card__title">{auth.session?.user.displayName || '家庭成员'}</Text>
      <Text className="list-card__meta">{babies.babies.length} 个宝宝空间</Text></View>
    <View className="settings-list">
      <View className="settings-item" onClick={() => void platform.navigateTo('/pages/babies/index')}><Text>宝宝档案</Text><Text>›</Text></View>
      <View className="settings-item"><Text>隐私政策</Text><Text>›</Text></View>
      <View className="settings-item"><Text>用户协议</Text><Text>›</Text></View>
    </View>
    {babies.babies.length === 0 ? <Button className="primary-button" onClick={() => void platform.navigateTo('/pages/babies/create')}>创建宝宝档案</Button> : null}
    <Button className="danger-link" onClick={() => setConfirming(true)}>退出登录</Button>
    <ConfirmDialog open={confirming} title="退出登录" description="退出后需要重新登录才能访问家庭成长记录。" confirmLabel="退出登录" cancelLabel="暂不退出"
      danger loading={loading} onConfirm={() => void performLogout()} onCancel={() => setConfirming(false)} />
  </View>
}

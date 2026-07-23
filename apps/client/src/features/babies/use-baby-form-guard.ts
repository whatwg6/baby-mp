import { useCallback, useEffect, useRef } from 'react'

import { platform, type UnsavedNavigationGuard } from '../../platform'

export function useBabyFormGuard(dirty: boolean) {
  const guardRef = useRef<UnsavedNavigationGuard>()
  const confirmDiscard = useCallback(async () => {
    const result = await platform.showModal(
      '放弃档案修改？',
      '尚未保存的宝宝档案和头像修改将会丢失。',
      '放弃修改',
      '继续编辑',
    )
    return result.confirm
  }, [])

  useEffect(() => {
    if (!dirty) return
    const guard = platform.guardUnsavedChanges(
      '尚未保存的宝宝档案和头像修改将会丢失。',
      confirmDiscard,
    )
    guardRef.current = guard
    return () => {
      if (guardRef.current === guard) guardRef.current = undefined
      guard.dispose()
    }
  }, [confirmDiscard, dirty])

  return useCallback(async () => {
    await guardRef.current?.release()
    guardRef.current = undefined
  }, [])
}

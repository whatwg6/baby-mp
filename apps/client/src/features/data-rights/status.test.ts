import { describe, expect, it } from 'vitest'

import {
  dataRightsConfirmation,
  dataRightsStatusLabel,
  dataRightsTypeLabel,
} from './status'

describe('data rights request presentation', () => {
  it('presents all request types and lifecycle statuses in user language', () => {
    expect(dataRightsTypeLabel('data_access')).toBe('数据访问申请')
    expect(dataRightsTypeLabel('correction')).toBe('数据更正申请')
    expect(dataRightsTypeLabel('account_deletion')).toBe('账号注销申请')
    expect(dataRightsStatusLabel('pending')).toBe('待人工核验')
    expect(dataRightsStatusLabel('processing')).toBe('处理中')
    expect(dataRightsStatusLabel('completed')).toBe('已完成')
    expect(dataRightsStatusLabel('rejected')).toBe('未通过')
    expect(dataRightsStatusLabel('cancelled')).toBe('已取消')
  })

  it('makes account deletion account-scoped and never claims immediate deletion', () => {
    const account = dataRightsConfirmation('account_deletion', '不会使用的宝宝名')
    expect(account).toContain('整个账号')
    expect(account).not.toContain('不会使用的宝宝名')
    expect(account).toContain('不代表数据已删除')

    const scoped = dataRightsConfirmation('correction', '测试宝宝')
    expect(scoped).toContain('当前宝宝“测试宝宝”')
    expect(scoped).toContain('待人工核验')
  })
})

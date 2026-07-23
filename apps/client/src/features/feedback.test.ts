import { describe, expect, it } from 'vitest'

import { internalTestFeedback } from './feedback'

describe('internal test feedback guidance', () => {
  it('gives actionable test-channel steps without inventing contact details', () => {
    expect(internalTestFeedback.message).toContain('邀请消息或测试群')
    expect(internalTestFeedback.message).toContain('设备型号、发生时间、操作步骤和页面截图')
    expect(internalTestFeedback.message).toContain('尚未公布正式客服')
    expect(internalTestFeedback.message).not.toMatch(/\b1[3-9]\d{9}\b|@|https?:\/\//)
  })
})

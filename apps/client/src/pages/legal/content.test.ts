import { describe, expect, it } from 'vitest'

import {
  dataRightsContent,
  privacyContent,
  termsContent,
  type LegalDocumentContent,
} from './content'

function textOf(document: LegalDocumentContent): string {
  return [
    document.title,
    document.summary,
    document.closingNote,
    ...document.sections.flatMap((section) => [
      section.title,
      ...(section.paragraphs ?? []),
      ...(section.items ?? []),
      section.note ?? '',
    ]),
  ].join('\n')
}

describe('legal document content', () => {
  it('covers every category processed by the current product', () => {
    const privacy = textOf(privacyContent)

    for (const phrase of [
      '平台身份',
      '业务用户 ID',
      '宝宝档案',
      '家庭协作',
      '图文正文',
      '身高和体重',
      '照片与文件',
      '数据导出',
      '运行与安全信息',
      '审计',
    ]) {
      expect(privacy).toContain(phrase)
    }
  })

  it('states private family visibility, short-lived access and exact export retention', () => {
    const all = [privacyContent, termsContent, dataRightsContent].map(textOf).join('\n')

    expect(all).toContain('仅向该宝宝空间中的有效家庭成员展示')
    expect(all).toContain('私有对象存储')
    expect(all).toContain('短期')
    expect(all).toContain('7 天')
    expect(all).toContain('最长约 5 分钟')
    expect(all).toContain('管理员')
  })

  it('does not overstate automatic erasure or undecided retention periods', () => {
    const privacy = textOf(privacyContent)
    const rights = textOf(dataRightsContent)
    const all = `${privacy}\n${rights}`

    expect(all).toContain('没有自动账号注销')
    expect(all).toContain('不代表所有备份和审计数据已经在同一时刻物理删除')
    expect(all).toContain('建议至少保留 30 天')
    expect(all).toContain('最终期限尚')
    expect(all).toContain('法定运营主体')
    expect(all).toContain('测试组织者已经提供的联系渠道')
  })

  it('keeps security-sensitive values out of support instructions', () => {
    const rights = textOf(dataRightsContent)
    const privacy = textOf(privacyContent)

    expect(rights).toContain('不要通过聊天发送访问令牌')
    expect(privacy).toContain('不得进入运行日志')
    expect(privacy).not.toContain('AppSecret')
  })
})

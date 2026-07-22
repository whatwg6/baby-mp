import { Text, View } from '@tarojs/components'

import type { LegalDocumentContent } from './content'

import './legal-document.scss'

interface LegalDocumentProps {
  content: LegalDocumentContent
}

export function LegalDocument({ content }: LegalDocumentProps) {
  return (
    <View className="page-shell legal-document">
      <View className="legal-document__hero">
        <Text className="legal-document__eyebrow">{content.eyebrow}</Text>
        <Text className="legal-document__title">{content.title}</Text>
        <Text className="legal-document__summary">{content.summary}</Text>
        <View className="legal-document__meta">
          <Text>{content.versionLabel}</Text>
          <Text>{content.effectiveLabel}</Text>
        </View>
      </View>

      <View className="legal-document__notice" role="note">
        <Text className="legal-document__notice-title">请先注意</Text>
        <Text>当前是内部测试版本。请不要把未补齐的运营主体、联系方式和最终保留期限理解为正式发布承诺。</Text>
      </View>

      <View className="legal-document__sections">
        {content.sections.map((section) => (
          <View className="legal-section" key={section.id}>
            <Text className="legal-section__title">{section.title}</Text>
            {section.paragraphs?.map((paragraph) => (
              <Text className="legal-section__paragraph" key={paragraph}>{paragraph}</Text>
            ))}
            {section.items?.map((item) => (
              <View className="legal-section__item" key={item}>
                <Text className="legal-section__bullet" aria-hidden>•</Text>
                <Text className="legal-section__item-text">{item}</Text>
              </View>
            ))}
            {section.note ? <Text className="legal-section__note">{section.note}</Text> : null}
          </View>
        ))}
      </View>

      <View className="legal-document__closing">
        <Text>{content.closingNote}</Text>
      </View>
    </View>
  )
}

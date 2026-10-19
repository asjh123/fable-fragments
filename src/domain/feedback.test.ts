import { describe, expect, it } from 'vitest'
import { bayesianStory } from '../content/bayesian'
import { selfHealingStory } from '../content/selfHealing'
import { createLearningEvent, learningEventSchema } from './events'
import {
  buildFeedbackReport,
  contentFeedbackPayloadSchema,
  createFeedbackPayload,
  createSkippedPayload,
  deriveInventory,
  derivePreferenceSignals,
  factReviewKeys,
  latestFeedbackByContent,
  recommendNextContent
} from './feedback'

const contents = [selfHealingStory, bayesianStory]

function feedbackEvent(
  contentId: string,
  rating: 'helpful' | 'neutral' | 'needs_work',
  reasons: Parameters<typeof createFeedbackPayload>[1] = [],
  occurredAt = '2026-10-19T04:00:00.000Z'
) {
  const pack = contents.find((item) => item.contentId === contentId) ?? selfHealingStory
  return createLearningEvent({
    userId: 'user-a',
    deviceId: 'phone',
    eventType: 'CONTENT_FEEDBACK_SUBMITTED',
    contentId,
    contentVersion: pack.version,
    payload: createFeedbackPayload(rating, reasons, '', new Date(occurredAt)),
    now: new Date(occurredAt)
  })
}

describe('内容反馈', () => {
  it('校验合法反馈并限制其他说明长度', () => {
    expect(contentFeedbackPayloadSchema.parse(createFeedbackPayload('helpful')).rating).toBe('helpful')
    expect(() => createFeedbackPayload('needs_work', [])).toThrow('至少选择一个原因')
    expect(() => createFeedbackPayload('neutral', ['too_long'])).toThrow('只有“差点意思”')
    expect(() => createFeedbackPayload('needs_work', ['other'], '字'.repeat(301))).toThrow()
  })

  it('学习事件严格验证反馈和跳过payload', () => {
    expect(learningEventSchema.parse(feedbackEvent(selfHealingStory.contentId, 'needs_work', ['too_shallow']))).toBeTruthy()
    const invalid = { ...feedbackEvent(selfHealingStory.contentId, 'helpful'), payload: { rating: 'helpful' } }
    expect(() => learningEventSchema.parse(invalid)).toThrow()
    const skipped = createLearningEvent({ userId: 'user-a', deviceId: 'phone', eventType: 'CONTENT_SKIPPED', contentId: selfHealingStory.contentId, contentVersion: 1, payload: createSkippedPayload() })
    expect(learningEventSchema.parse(skipped).eventType).toBe('CONTENT_SKIPPED')
  })

  it('同一内容只采用最新反馈', () => {
    const older = feedbackEvent(selfHealingStory.contentId, 'needs_work', ['fact_doubt'], '2026-10-19T04:00:00.000Z')
    const newer = feedbackEvent(selfHealingStory.contentId, 'helpful', [], '2026-10-19T05:00:00.000Z')
    expect(latestFeedbackByContent([newer, older]).get(`${selfHealingStory.contentId}@1`)?.payload.rating).toBe('helpful')
  })

  it('少于三次不形成偏好信号，三次后才形成', () => {
    const duplicatedContents = [
      selfHealingStory,
      { ...selfHealingStory, contentId: 'self-healing-two' },
      { ...selfHealingStory, contentId: 'self-healing-three' }
    ]
    const two = duplicatedContents.slice(0, 2).map((pack, index) => feedbackEvent(pack.contentId, 'helpful', [], `2026-10-19T0${index + 4}:00:00.000Z`))
    expect(derivePreferenceSignals(duplicatedContents, two)).toEqual([])
    const third = feedbackEvent(duplicatedContents[2].contentId, 'helpful', [], '2026-10-19T06:00:00.000Z')
    expect(derivePreferenceSignals(duplicatedContents, [...two, third])).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'domain', label: selfHealingStory.domain, count: 3 }),
      expect.objectContaining({ kind: 'rating', key: 'helpful', count: 3 })
    ]))
  })

  it('按最新发布版本统计库存，已完成内容不计入未读', () => {
    const newer = { ...selfHealingStory, version: 2, contentHash: '', updatedAt: '2026-10-19T00:00:00.000Z' }
    const completed = createLearningEvent({ userId: 'user-a', deviceId: 'phone', eventType: 'STORY_COMPLETED', contentId: newer.contentId, contentVersion: 2 })
    expect(deriveInventory([...contents, newer], [completed])).toMatchObject({ available: 2, completed: 1, unread: 1, isLow: true })
  })

  it('跳过不会成为差评，只降低本次推荐优先级', () => {
    const skipped = createLearningEvent({ userId: 'user-a', deviceId: 'phone', eventType: 'CONTENT_SKIPPED', contentId: selfHealingStory.contentId, contentVersion: 1, payload: createSkippedPayload() })
    expect(latestFeedbackByContent([skipped]).size).toBe(0)
    expect(recommendNextContent(contents, [skipped])?.contentId).toBe(bayesianStory.contentId)
  })

  it('事实待复核状态可由更新反馈撤销', () => {
    const doubt = feedbackEvent(selfHealingStory.contentId, 'needs_work', ['fact_doubt'], '2026-10-19T04:00:00.000Z')
    expect(factReviewKeys([doubt])).toContain(`${selfHealingStory.contentId}@1`)
    const corrected = feedbackEvent(selfHealingStory.contentId, 'neutral', [], '2026-10-19T05:00:00.000Z')
    expect(factReviewKeys([doubt, corrected])).not.toContain(`${selfHealingStory.contentId}@1`)
  })

  it('反馈报告不包含账号、令牌、设备或普通笔记', () => {
    const feedback = feedbackEvent(selfHealingStory.contentId, 'needs_work', ['other'])
    const note = createLearningEvent({ userId: 'secret-user', deviceId: 'secret-device', eventType: 'NOTE_SAVED', contentId: selfHealingStory.contentId, contentVersion: 1, payload: { text: 'private-note', accessToken: 'secret-token' } })
    const text = JSON.stringify(buildFeedbackReport(contents, [feedback, note], new Date('2026-10-19T06:00:00.000Z')))
    expect(text).not.toContain('secret-user')
    expect(text).not.toContain('secret-device')
    expect(text).not.toContain('private-note')
    expect(text).not.toContain('secret-token')
  })
})

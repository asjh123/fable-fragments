import { z } from 'zod'
import { contentKey, type ContentPack } from './content'
import type { LearningEvent } from './events'

export const INVENTORY_LOW_THRESHOLD = 3
export const PREFERENCE_SIGNAL_THRESHOLD = 3

export const feedbackRatingSchema = z.enum(['helpful', 'neutral', 'needs_work'])
export const feedbackReasonSchema = z.enum([
  'too_shallow',
  'too_hard',
  'forced_story',
  'unclear',
  'early_reveal',
  'low_relevance',
  'too_long',
  'fact_doubt',
  'other'
])

export const feedbackReasonLabels: Record<z.infer<typeof feedbackReasonSchema>, string> = {
  too_shallow: '内容太浅',
  too_hard: '内容太难',
  forced_story: '故事太牵强',
  unclear: '解释不清楚',
  early_reveal: '太早猜到答案',
  low_relevance: '和我的工作关系不大',
  too_long: '内容太长',
  fact_doubt: '怀疑事实有误',
  other: '其他'
}

export const contentFeedbackPayloadSchema = z.object({
  rating: feedbackRatingSchema,
  reasons: z.array(feedbackReasonSchema).max(9),
  optionalComment: z.string().trim().max(300).optional(),
  submittedAt: z.string().datetime(),
  schemaVersion: z.literal(1)
}).strict().superRefine((payload, context) => {
  if (new Set(payload.reasons).size !== payload.reasons.length) {
    context.addIssue({ code: 'custom', path: ['reasons'], message: '反馈原因不能重复' })
  }
  if (payload.rating === 'needs_work' && payload.reasons.length === 0) {
    context.addIssue({ code: 'custom', path: ['reasons'], message: '请至少选择一个原因' })
  }
  if (payload.rating !== 'needs_work' && payload.reasons.length > 0) {
    context.addIssue({ code: 'custom', path: ['reasons'], message: '只有“差点意思”需要选择原因' })
  }
})

export const contentSkippedPayloadSchema = z.object({
  skippedAt: z.string().datetime(),
  schemaVersion: z.literal(1)
}).strict()

export type FeedbackRating = z.infer<typeof feedbackRatingSchema>
export type FeedbackReason = z.infer<typeof feedbackReasonSchema>
export type ContentFeedbackPayload = z.infer<typeof contentFeedbackPayloadSchema>

export function createFeedbackPayload(
  rating: FeedbackRating,
  reasons: FeedbackReason[] = [],
  optionalComment = '',
  now = new Date()
): ContentFeedbackPayload {
  return contentFeedbackPayloadSchema.parse({
    rating,
    reasons,
    optionalComment: optionalComment.trim() || undefined,
    submittedAt: now.toISOString(),
    schemaVersion: 1
  })
}

export function createSkippedPayload(now = new Date()) {
  return contentSkippedPayloadSchema.parse({ skippedAt: now.toISOString(), schemaVersion: 1 })
}

export interface FeedbackEntry {
  event: LearningEvent
  payload: ContentFeedbackPayload
}

export function latestFeedbackByContent(events: LearningEvent[]): Map<string, FeedbackEntry> {
  const result = new Map<string, FeedbackEntry>()
  for (const event of events) {
    if (event.eventType !== 'CONTENT_FEEDBACK_SUBMITTED') continue
    const parsed = contentFeedbackPayloadSchema.safeParse(event.payload)
    if (!parsed.success) continue
    const key = contentKey(event.contentId, event.contentVersion)
    const current = result.get(key)
    if (!current || event.occurredAt > current.event.occurredAt ||
      (event.occurredAt === current.event.occurredAt && event.eventId > current.event.eventId)) {
      result.set(key, { event, payload: parsed.data })
    }
  }
  return result
}

export function latestPublishedContents(contents: ContentPack[]): ContentPack[] {
  const latest = new Map<string, ContentPack>()
  for (const pack of contents) {
    if (pack.status !== 'published') continue
    const current = latest.get(pack.contentId)
    if (!current || pack.version > current.version) latest.set(pack.contentId, pack)
  }
  return [...latest.values()].sort((left, right) =>
    left.publishedAt?.localeCompare(right.publishedAt ?? '') || left.contentId.localeCompare(right.contentId))
}

export interface InventorySummary {
  available: number
  completed: number
  unread: number
  isLow: boolean
}

export function deriveInventory(contents: ContentPack[], events: LearningEvent[]): InventorySummary {
  const available = latestPublishedContents(contents)
  const completed = new Set(events
    .filter((event) => event.eventType === 'STORY_COMPLETED')
    .map((event) => contentKey(event.contentId, event.contentVersion)))
  const completedCount = available.filter((pack) => completed.has(contentKey(pack.contentId, pack.version))).length
  const unread = available.length - completedCount
  return { available: available.length, completed: completedCount, unread, isLow: unread < INVENTORY_LOW_THRESHOLD }
}

export function recommendNextContent(contents: ContentPack[], events: LearningEvent[], currentKey?: string): ContentPack | null {
  const completed = new Set(events
    .filter((event) => event.eventType === 'STORY_COMPLETED')
    .map((event) => contentKey(event.contentId, event.contentVersion)))
  const lastSkipped = new Map<string, string>()
  for (const event of events) {
    if (event.eventType !== 'CONTENT_SKIPPED') continue
    const key = contentKey(event.contentId, event.contentVersion)
    if ((lastSkipped.get(key) ?? '') < event.occurredAt) lastSkipped.set(key, event.occurredAt)
  }
  const unread = latestPublishedContents(contents)
    .filter((pack) => {
      const key = contentKey(pack.contentId, pack.version)
      return key !== currentKey && !completed.has(key)
    })
  return unread.sort((left, right) => {
    const leftSkipped = lastSkipped.get(contentKey(left.contentId, left.version))
    const rightSkipped = lastSkipped.get(contentKey(right.contentId, right.version))
    if (!leftSkipped && rightSkipped) return -1
    if (leftSkipped && !rightSkipped) return 1
    return (leftSkipped ?? '').localeCompare(rightSkipped ?? '')
  })[0] ?? null
}

export interface PreferenceSignal {
  kind: 'domain' | 'difficulty' | 'reason' | 'rating'
  key: string
  label: string
  count: number
}

export function derivePreferenceSignals(contents: ContentPack[], events: LearningEvent[], threshold = PREFERENCE_SIGNAL_THRESHOLD): PreferenceSignal[] {
  const packs = new Map(latestPublishedContents(contents).map((pack) => [contentKey(pack.contentId, pack.version), pack]))
  const feedback = latestFeedbackByContent(events)
  const counts = new Map<string, PreferenceSignal>()
  const add = (kind: PreferenceSignal['kind'], key: string, label: string) => {
    const id = `${kind}:${key}`
    const current = counts.get(id)
    counts.set(id, { kind, key, label, count: (current?.count ?? 0) + 1 })
  }
  for (const [key, entry] of feedback) {
    const pack = packs.get(key)
    if (!pack) continue
    add('rating', entry.payload.rating, entry.payload.rating === 'helpful' ? '有收获' : entry.payload.rating === 'neutral' ? '一般' : '差点意思')
    if (entry.payload.rating === 'helpful') {
      add('domain', pack.domain, pack.domain)
      add('difficulty', pack.difficulty, pack.difficulty)
    }
    for (const reason of entry.payload.reasons) add('reason', reason, feedbackReasonLabels[reason])
  }
  return [...counts.values()].filter((signal) => signal.count >= threshold).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'zh-CN'))
}

export function factReviewKeys(events: LearningEvent[]): Set<string> {
  return new Set([...latestFeedbackByContent(events)]
    .filter(([, entry]) => entry.payload.rating === 'needs_work' && entry.payload.reasons.includes('fact_doubt'))
    .map(([key]) => key))
}

export const feedbackReportItemSchema = z.object({
  contentId: z.string().min(3).max(80),
  contentVersion: z.number().int().positive(),
  domain: z.string().min(1).max(80),
  difficulty: z.enum(['入门', '进阶', '研究生']),
  rating: feedbackRatingSchema,
  reasons: z.array(feedbackReasonSchema).max(9),
  optionalComment: z.string().max(300).optional(),
  submittedAt: z.string().datetime()
}).strict()

export const feedbackReportSchema = z.object({
  schemaVersion: z.literal(1),
  exportedAt: z.string().datetime(),
  items: z.array(feedbackReportItemSchema).max(500)
}).strict()

export type FeedbackReport = z.infer<typeof feedbackReportSchema>

export function buildFeedbackReport(contents: ContentPack[], events: LearningEvent[], now = new Date()): FeedbackReport {
  const packs = new Map(contents.map((pack) => [contentKey(pack.contentId, pack.version), pack]))
  const items = [...latestFeedbackByContent(events)].flatMap(([key, entry]) => {
    const pack = packs.get(key)
    if (!pack) return []
    return [{
      contentId: pack.contentId,
      contentVersion: pack.version,
      domain: pack.domain,
      difficulty: pack.difficulty,
      rating: entry.payload.rating,
      reasons: entry.payload.reasons,
      optionalComment: entry.payload.optionalComment,
      submittedAt: entry.payload.submittedAt
    }]
  })
  return feedbackReportSchema.parse({ schemaVersion: 1, exportedAt: now.toISOString(), items })
}

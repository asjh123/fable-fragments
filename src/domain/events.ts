import { z } from 'zod'
import { contentKey } from './content'

export const eventTypeSchema = z.enum([
  'FRAGMENT_COMPLETED',
  'QUIZ_ANSWERED',
  'CONCEPT_VIEWED',
  'NOTE_SAVED',
  'STORY_STARTED',
  'STORY_COMPLETED'
])

export const syncStatusSchema = z.enum(['pending', 'synced', 'failed'])

export const learningEventSchema = z.object({
  eventId: z.string().uuid(),
  userId: z.string().min(1).max(200),
  deviceId: z.string().min(1).max(200),
  eventType: eventTypeSchema,
  contentId: z.string().min(3).max(80),
  contentVersion: z.number().int().positive(),
  fragmentId: z.string().max(80).nullable(),
  occurredAt: z.string().datetime(),
  studyDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  timezone: z.literal('Asia/Shanghai'),
  payload: z.record(z.string(), z.unknown()),
  schemaVersion: z.literal(1),
  createdAt: z.string().datetime(),
  syncStatus: syncStatusSchema
}).strict()

export type LearningEvent = z.infer<typeof learningEventSchema>
export type EventType = z.infer<typeof eventTypeSchema>

const effectiveTypes = new Set<EventType>([
  'FRAGMENT_COMPLETED',
  'QUIZ_ANSWERED',
  'CONCEPT_VIEWED',
  'NOTE_SAVED',
  'STORY_STARTED',
  'STORY_COMPLETED'
])

export function shanghaiDate(input: Date | string = new Date()): string {
  const date = typeof input === 'string' ? new Date(input) : input
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date)
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

export function createLearningEvent(input: {
  userId: string
  deviceId: string
  eventType: EventType
  contentId: string
  contentVersion: number
  fragmentId?: string | null
  payload?: Record<string, unknown>
  now?: Date
}): LearningEvent {
  const now = input.now ?? new Date()
  const iso = now.toISOString()
  return learningEventSchema.parse({
    eventId: crypto.randomUUID(),
    userId: input.userId,
    deviceId: input.deviceId,
    eventType: input.eventType,
    contentId: input.contentId,
    contentVersion: input.contentVersion,
    fragmentId: input.fragmentId ?? null,
    occurredAt: iso,
    studyDate: shanghaiDate(now),
    timezone: 'Asia/Shanghai',
    payload: input.payload ?? {},
    schemaVersion: 1,
    createdAt: iso,
    syncStatus: 'pending'
  })
}

export function mergeEvents(...collections: LearningEvent[][]): LearningEvent[] {
  const unique = new Map<string, LearningEvent>()
  for (const event of collections.flat()) {
    const valid = learningEventSchema.parse(event)
    const existing = unique.get(valid.eventId)
    if (!existing || (existing.syncStatus !== 'synced' && valid.syncStatus === 'synced')) unique.set(valid.eventId, valid)
  }
  return [...unique.values()].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))
}

export function completedFragments(events: LearningEvent[], contentId: string, version: number): Set<string> {
  return new Set(events
    .filter((event) => event.eventType === 'FRAGMENT_COMPLETED' && event.contentId === contentId && event.contentVersion === version && event.fragmentId)
    .map((event) => event.fragmentId as string))
}

export function didStudyOn(events: LearningEvent[], date = shanghaiDate()): boolean {
  return events.some((event) => event.studyDate === date && effectiveTypes.has(event.eventType))
}

export function latestNote(events: LearningEvent[], contentId: string, version: number): string {
  return events
    .filter((event) => event.eventType === 'NOTE_SAVED' && contentKey(event.contentId, event.contentVersion) === contentKey(contentId, version))
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
    .map((event) => typeof event.payload.text === 'string' ? event.payload.text : '')[0] ?? ''
}


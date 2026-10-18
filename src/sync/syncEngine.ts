import type { ContentPack } from '../domain/content'
import type { LearningEvent } from '../domain/events'
import { learningEventSchema } from '../domain/events'
import { adoptLocalEvents, saveContent } from '../data/repository'
import { db, type LearningDatabase } from '../data/db'

export const SYNC_PAGE_SIZE = 500
const MAX_SYNC_PAGES = 200

export interface SyncCursor { createdAt: string; eventId: string }
export interface PulledEventsPage { events: LearningEvent[]; cursor: SyncCursor | null; hasMore: boolean }
export interface RemoteSyncAdapter {
  getUserId(): Promise<string | null>
  upload(events: LearningEvent[]): Promise<void>
  pull(cursor: SyncCursor | null, limit: number): Promise<PulledEventsPage>
  pullPublishedContents?(): Promise<ContentPack[]>
}
export type SyncStage = 'not-run' | 'success' | 'failed'
export interface SyncOutcome {
  status: 'local-only' | 'synced' | 'partial'
  uploaded: number
  downloaded: number
  contentsDownloaded: number
  uploadStatus: SyncStage
  downloadStatus: SyncStage
  errorMessage?: string
}

const activeSyncs = new WeakMap<LearningDatabase, Promise<SyncOutcome>>()

export function syncNow(adapter: RemoteSyncAdapter | null, database: LearningDatabase = db): Promise<SyncOutcome> {
  const running = activeSyncs.get(database)
  if (running) return running
  const task = performSync(adapter, database).finally(() => activeSyncs.delete(database))
  activeSyncs.set(database, task)
  return task
}

async function performSync(adapter: RemoteSyncAdapter | null, database: LearningDatabase): Promise<SyncOutcome> {
  const empty: SyncOutcome = { status: 'local-only', uploaded: 0, downloaded: 0, contentsDownloaded: 0, uploadStatus: 'not-run', downloadStatus: 'not-run' }
  if (!adapter) return empty
  const userId = await adapter.getUserId()
  if (!userId) return empty
  await adoptLocalEvents(userId, database)
  const pending = await database.events.where('syncStatus').anyOf('pending', 'failed').and((event) => event.userId === userId).toArray()
  let uploaded = 0
  try {
    for (let offset = 0; offset < pending.length; offset += 100) {
      const batch = pending.slice(offset, offset + 100)
      await adapter.upload(batch)
      await database.events.bulkUpdate(batch.map((event) => ({ key: event.eventId, changes: { syncStatus: 'synced' as const } })))
      uploaded += batch.length
    }
  } catch (error) {
    const unconfirmed = pending.slice(uploaded)
    if (unconfirmed.length) await database.events.bulkUpdate(unconfirmed.map((event) => ({ key: event.eventId, changes: { syncStatus: 'failed' as const } })))
    return { ...empty, status: 'partial', uploaded, uploadStatus: 'failed', errorMessage: messageOf(error, '上传失败，本机记录已保留') }
  }

  let downloaded = 0
  let contentsDownloaded = 0
  try {
    if (adapter.pullPublishedContents) {
      const contents = await adapter.pullPublishedContents()
      for (const pack of contents) await saveContent(pack, database)
      contentsDownloaded = contents.length
    }
    let cursor = parseCursor((await database.settings.get(`syncCursor:${userId}`))?.value)
    for (let pageNumber = 0; pageNumber < MAX_SYNC_PAGES; pageNumber += 1) {
      const page = await adapter.pull(cursor, SYNC_PAGE_SIZE)
      const remote = page.events.map((event) => learningEventSchema.parse({ ...event, syncStatus: 'synced' }))
      const existingIds = new Set((await database.events.bulkGet(remote.map((event) => event.eventId))).filter(Boolean).map((event) => event!.eventId))
      await database.transaction('rw', database.events, database.settings, async () => {
        if (remote.length) await database.events.bulkPut(remote)
        if (page.cursor) await database.settings.put({ key: `syncCursor:${userId}`, value: page.cursor })
      })
      downloaded += remote.filter((event) => !existingIds.has(event.eventId)).length
      if (!page.hasMore) break
      if (!page.cursor || sameCursor(cursor, page.cursor)) throw new Error('云端分页游标没有前进，已停止同步')
      cursor = page.cursor
      if (pageNumber === MAX_SYNC_PAGES - 1) throw new Error('本次同步页数超过安全上限')
    }
    await database.settings.bulkPut([
      { key: `lastSync:${userId}`, value: new Date().toISOString() },
      { key: `lastSyncError:${userId}`, value: null }
    ])
    return { status: 'synced', uploaded, downloaded, contentsDownloaded, uploadStatus: 'success', downloadStatus: 'success' }
  } catch (error) {
    const errorMessage = messageOf(error, '下载失败，已经上传的记录不会重复或丢失')
    await database.settings.put({ key: `lastSyncError:${userId}`, value: errorMessage })
    return { status: 'partial', uploaded, downloaded, contentsDownloaded, uploadStatus: 'success', downloadStatus: 'failed', errorMessage }
  }
}

export function parseCursor(value: unknown): SyncCursor | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<SyncCursor>
  if (typeof candidate.createdAt !== 'string' || Number.isNaN(Date.parse(candidate.createdAt))) return null
  if (typeof candidate.eventId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidate.eventId)) return null
  return { createdAt: candidate.createdAt, eventId: candidate.eventId }
}
function sameCursor(left: SyncCursor | null, right: SyncCursor) { return left?.createdAt === right.createdAt && left.eventId === right.eventId }
function messageOf(error: unknown, fallback: string) {
  if (error instanceof Error && error.name === 'ZodError') return '云端记录格式暂不兼容，本机数据已保留，请更新应用后重试'
  return error instanceof Error && error.message ? error.message : fallback
}

interface MemoryRemoteEvent { event: LearningEvent; serverCreatedAt: string }
export class MemorySyncAdapter implements RemoteSyncAdapter {
  private readonly events = new Map<string, MemoryRemoteEvent>()
  private readonly contents = new Map<string, ContentPack>()
  private pullFailureCall: number | null = null
  private pullCalls = 0
  uploadCalls = 0
  constructor(private readonly userId: string | null = 'test-user') {}
  async getUserId() { return this.userId }
  async upload(events: LearningEvent[]) {
    this.uploadCalls += 1
    for (const event of events) {
      if (this.userId && event.userId !== this.userId) throw new Error('用户数据隔离失败')
      this.events.set(event.eventId, this.events.get(event.eventId) ?? { event: { ...event, syncStatus: 'synced' }, serverCreatedAt: new Date().toISOString() })
    }
  }
  async pull(cursor: SyncCursor | null, limit: number): Promise<PulledEventsPage> {
    this.pullCalls += 1
    if (this.pullFailureCall === this.pullCalls) throw new Error('模拟下载失败')
    const ordered = [...this.events.values()]
      .sort((a, b) => a.serverCreatedAt.localeCompare(b.serverCreatedAt) || a.event.eventId.localeCompare(b.event.eventId))
      .filter(({ event, serverCreatedAt }) => !cursor || serverCreatedAt > cursor.createdAt || (serverCreatedAt === cursor.createdAt && event.eventId > cursor.eventId))
    const page = ordered.slice(0, limit)
    const last = page.at(-1)
    return { events: page.map(({ event }) => ({ ...event, syncStatus: 'synced' })), cursor: last ? { createdAt: last.serverCreatedAt, eventId: last.event.eventId } : cursor, hasMore: ordered.length > page.length }
  }
  async pullPublishedContents() { return [...this.contents.values()] }
  seed(event: LearningEvent, serverCreatedAt = event.createdAt) { this.events.set(event.eventId, { event: { ...event, syncStatus: 'synced' }, serverCreatedAt }) }
  seedContent(pack: ContentPack) { this.contents.set(`${pack.contentId}@${pack.version}`, pack) }
  failPullOnCall(call: number) { this.pullFailureCall = call }
  size() { return this.events.size }
}

import { afterEach, describe, expect, it } from 'vitest'
import { bayesianStory } from '../content/bayesian'
import { completedFragments, createLearningEvent, latestNote } from '../domain/events'
import { LearningDatabase } from '../data/db'
import { saveEvent } from '../data/repository'
import { MemorySyncAdapter, parseCursor, syncNow } from './syncEngine'

let databases: LearningDatabase[] = []
const makeDb = () => { const value = new LearningDatabase(`sync-test-${crypto.randomUUID()}`); databases.push(value); return value }
afterEach(async () => { for (const database of databases) { database.close(); await database.delete() }; databases = [] })

function remoteEvent(index: number, userId = 'user-a') {
  const event = createLearningEvent({ userId, deviceId: 'phone', eventType: 'FRAGMENT_COMPLETED', contentId: 'story-one', contentVersion: 1, fragmentId: `f${index}` })
  return { ...event, eventId: `${index.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000` }
}

describe('事件同步', () => {
  it('上传幂等并把本地用户归入唯一登录账户', async () => {
    const database = makeDb(); const adapter = new MemorySyncAdapter('user-a')
    const event = createLearningEvent({ userId: 'local:device-a', deviceId: 'device-a', eventType: 'FRAGMENT_COMPLETED', contentId: 'story-one', contentVersion: 1, fragmentId: 'f1' })
    await saveEvent(event, database)
    expect((await syncNow(adapter, database)).uploaded).toBe(1)
    expect((await syncNow(adapter, database)).uploaded).toBe(0)
    expect(adapter.size()).toBe(1)
    expect((await database.events.get(event.eventId))?.userId).toBe('user-a')
  })

  it('使用复合游标完整拉取1001条相同服务器时间的事件', async () => {
    const database = makeDb(); const adapter = new MemorySyncAdapter('user-a')
    const serverTime = '2026-10-15T00:00:00.000Z'
    for (let index = 1; index <= 1001; index += 1) adapter.seed(remoteEvent(index), serverTime)
    const result = await syncNow(adapter, database)
    expect(result.downloaded).toBe(1001)
    expect(await database.events.count()).toBe(1001)
    expect((await syncNow(adapter, database)).downloaded).toBe(0)
  })

  it('逐页落库后下载失败，重试从已保存游标继续', async () => {
    const database = makeDb(); const adapter = new MemorySyncAdapter('user-a')
    const serverTime = '2026-10-15T00:00:00.000Z'
    for (let index = 1; index <= 600; index += 1) adapter.seed(remoteEvent(index), serverTime)
    adapter.failPullOnCall(2)
    const first = await syncNow(adapter, database)
    expect(first.status).toBe('partial'); expect(first.downloaded).toBe(500)
    const second = await syncNow(adapter, database)
    expect(second.status).toBe('synced'); expect(second.downloaded).toBe(100)
    expect(await database.events.count()).toBe(600)
  })

  it('上传成功但下载失败时不把已上传事件改回失败', async () => {
    const database = makeDb(); const adapter = new MemorySyncAdapter('user-a')
    const event = createLearningEvent({ userId: 'local:device', deviceId: 'device', eventType: 'STORY_STARTED', contentId: 'story-one', contentVersion: 1 })
    await saveEvent(event, database); adapter.failPullOnCall(1)
    const result = await syncNow(adapter, database)
    expect(result.uploadStatus).toBe('success'); expect(result.downloadStatus).toBe('failed')
    expect((await database.events.get(event.eventId))?.syncStatus).toBe('synced')
  })

  it('并发触发复用同一个同步Promise', async () => {
    const database = makeDb(); const adapter = new MemorySyncAdapter('user-a')
    const first = syncNow(adapter, database); const second = syncNow(adapter, database)
    expect(first).toBe(second)
    await Promise.all([first, second])
  })

  it('全新设备恢复云端内容和事件', async () => {
    const database = makeDb(); const adapter = new MemorySyncAdapter('user-a')
    const fragment = createLearningEvent({ userId: 'user-a', deviceId: 'phone', eventType: 'FRAGMENT_COMPLETED', contentId: bayesianStory.contentId, contentVersion: 1, fragmentId: bayesianStory.fragments[0].fragmentId })
    const quiz = createLearningEvent({ userId: 'user-a', deviceId: 'phone', eventType: 'QUIZ_ANSWERED', contentId: bayesianStory.contentId, contentVersion: 1, payload: { choice: 1, correct: true } })
    const note = createLearningEvent({ userId: 'user-a', deviceId: 'phone', eventType: 'NOTE_SAVED', contentId: bayesianStory.contentId, contentVersion: 1, payload: { text: '证据会更新判断' } })
    adapter.seedContent(bayesianStory); adapter.seed(fragment); adapter.seed(quiz); adapter.seed(note)
    const result = await syncNow(adapter, database)
    expect(result.contentsDownloaded).toBe(1)
    expect(await database.contents.count()).toBe(1)
    const restored = await database.events.toArray()
    expect(restored).toHaveLength(3)
    expect(completedFragments(restored, bayesianStory.contentId, 1)).toContain(bayesianStory.fragments[0].fragmentId)
    expect(latestNote(restored, bayesianStory.contentId, 1)).toBe('证据会更新判断')
    expect(restored.filter((event) => event.syncStatus !== 'synced')).toHaveLength(0)
  })

  it('空结果正常结束，无效远端事件不写入也不推进游标', async () => {
    const emptyDatabase = makeDb(); const emptyAdapter = new MemorySyncAdapter('user-a')
    expect((await syncNow(emptyAdapter, emptyDatabase)).downloaded).toBe(0)

    const database = makeDb()
    const adapter = {
      async getUserId() { return 'user-a' },
      async upload() {},
      async pull() {
        return { events: [{ ...remoteEvent(1), eventId: 'invalid' }], cursor: { createdAt: '2026-10-15T00:00:00.000Z', eventId: 'invalid' }, hasMore: false }
      }
    }
    const result = await syncNow(adapter as never, database)
    expect(result.downloadStatus).toBe('failed')
    expect(await database.events.count()).toBe(0)
    expect(await database.settings.get('syncCursor:user-a')).toBeUndefined()
  })

  it('拒绝不同账户上传并忽略旧字符串游标', async () => {
    const adapter = new MemorySyncAdapter('user-a')
    await expect(adapter.upload([remoteEvent(1, 'user-b')])).rejects.toThrow('隔离失败')
    expect(parseCursor('2026-10-15T00:00:00.000Z')).toBeNull()
    expect(parseCursor({ createdAt: '2026-10-15T00:00:00.000Z', eventId: 'x),user_id.neq.owner' })).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'
import { completedFragments, createLearningEvent, didStudyOn, latestNote, mergeEvents, shanghaiDate } from './events'

const event = (overrides: Partial<ReturnType<typeof createLearningEvent>> = {}) => ({
  ...createLearningEvent({ userId: 'user-a', deviceId: 'device-a', eventType: 'FRAGMENT_COMPLETED', contentId: 'story-one', contentVersion: 1, fragmentId: 'f1', now: new Date('2026-10-13T04:15:00.000Z') }),
  ...overrides
})

describe('学习事件推导', () => {
  it('按照上海时区跨日', () => {
    expect(shanghaiDate('2026-01-01T15:59:59.000Z')).toBe('2026-01-01')
    expect(shanghaiDate('2026-01-01T16:00:00.000Z')).toBe('2026-01-02')
  })

  it('任意有效事件点亮当天，但不会生成缺席债务', () => {
    const events = [event()]
    expect(didStudyOn(events, '2026-10-13')).toBe(true)
    expect(didStudyOn(events, '2026-10-12')).toBe(false)
  })

  it('重复事件合并后只保留一次', () => {
    const item = event()
    const merged = mergeEvents([item], [{ ...item, syncStatus: 'synced' }])
    expect(merged).toHaveLength(1)
    expect(merged[0].syncStatus).toBe('synced')
  })

  it('按内容版本计算片段，笔记保留历史并显示最新值', () => {
    const first = event()
    const otherVersion = event({ eventId: crypto.randomUUID(), contentVersion: 2, fragmentId: 'f2' })
    const noteOld = event({ eventId: crypto.randomUUID(), eventType: 'NOTE_SAVED', fragmentId: null, occurredAt: '2026-10-13T05:00:00.000Z', payload: { text: '旧理解' } })
    const noteNew = event({ eventId: crypto.randomUUID(), eventType: 'NOTE_SAVED', fragmentId: null, occurredAt: '2026-10-13T06:00:00.000Z', payload: { text: '新理解' } })
    expect([...completedFragments([first, otherVersion], 'story-one', 1)]).toEqual(['f1'])
    expect(latestNote([noteOld, noteNew], 'story-one', 1)).toBe('新理解')
  })
})


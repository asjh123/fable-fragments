import { afterEach, describe, expect, it } from 'vitest'
import { selfHealingStory } from '../content/selfHealing'
import { createLearningEvent } from '../domain/events'
import { LearningDatabase } from './db'
import { exportBackup, importBackupText, importContentText, saveContent, saveEvent } from './repository'

let database: LearningDatabase | null = null
const makeDb = () => {
  database = new LearningDatabase(`test-${crypto.randomUUID()}`)
  return database
}

afterEach(async () => {
  if (database) { database.close(); await database.delete(); database = null }
})

describe('本地仓库', () => {
  it('保存内容和事件，导出后可以重新合并', async () => {
    const db = makeDb()
    await saveContent(selfHealingStory, db)
    await saveEvent(createLearningEvent({ userId: 'local:test', deviceId: 'test', eventType: 'STORY_STARTED', contentId: selfHealingStory.contentId, contentVersion: 1 }), db)
    const backup = await exportBackup(db)
    expect(backup.contents).toHaveLength(1)
    expect(backup.events).toHaveLength(1)
    await importBackupText(JSON.stringify(backup), db)
    expect(await db.events.count()).toBe(1)
  })

  it('拒绝非法JSON和未知字段', async () => {
    const db = makeDb()
    await expect(importContentText('not json', db)).rejects.toThrow('有效的JSON')
    await expect(importContentText(JSON.stringify({ ...selfHealingStory, extra: 'no' }), db)).rejects.toThrow()
  })
})


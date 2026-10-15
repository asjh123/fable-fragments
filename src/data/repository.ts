import { z } from 'zod'
import { contentKey, contentPackSchema, parseContentPack, type ContentPack } from '../domain/content'
import { learningEventSchema, mergeEvents, type LearningEvent } from '../domain/events'
import { db, type LearningDatabase } from './db'

const MAX_IMPORT_BYTES = 1024 * 1024

const backupSchema = z.object({
  schemaVersion: z.literal(1),
  exportedAt: z.string().datetime(),
  contents: z.array(contentPackSchema).max(500),
  events: z.array(learningEventSchema).max(50000)
}).strict()

export type LearningBackup = z.infer<typeof backupSchema>

export async function getDeviceId(database: LearningDatabase = db): Promise<string> {
  const existing = await database.settings.get('deviceId')
  if (typeof existing?.value === 'string') return existing.value
  const value = crypto.randomUUID()
  await database.settings.put({ key: 'deviceId', value })
  return value
}

export async function getLocalUserId(database: LearningDatabase = db): Promise<string> {
  const deviceId = await getDeviceId(database)
  return `local:${deviceId}`
}

export async function saveContent(pack: ContentPack, database: LearningDatabase = db): Promise<void> {
  const valid = parseContentPack(pack)
  await database.contents.put({ ...valid, key: contentKey(valid.contentId, valid.version) })
}

export async function saveEvent(event: LearningEvent, database: LearningDatabase = db): Promise<void> {
  await database.events.put(learningEventSchema.parse(event))
}

export async function adoptLocalEvents(userId: string, database: LearningDatabase = db): Promise<void> {
  const localEvents = await database.events.filter((event) => event.userId.startsWith('local:')).toArray()
  await database.transaction('rw', database.events, async () => {
    for (const event of localEvents) await database.events.update(event.eventId, { userId, syncStatus: 'pending' })
  })
}

export async function importContentText(text: string, database: LearningDatabase = db): Promise<ContentPack> {
  if (new Blob([text]).size > MAX_IMPORT_BYTES) throw new Error('内容包超过1 MB，已拒绝导入')
  let raw: unknown
  try { raw = JSON.parse(text) } catch { throw new Error('这不是有效的JSON内容包') }
  const pack = parseContentPack(raw)
  await saveContent(pack, database)
  return pack
}

export async function exportBackup(database: LearningDatabase = db): Promise<LearningBackup> {
  const storedContents = await database.contents.toArray()
  return backupSchema.parse({
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    contents: storedContents.map(({ key: _key, ...pack }) => pack),
    events: await database.events.toArray()
  })
}

export async function importBackupText(text: string, database: LearningDatabase = db): Promise<LearningBackup> {
  if (new Blob([text]).size > MAX_IMPORT_BYTES) throw new Error('备份超过1 MB，已拒绝导入')
  let raw: unknown
  try { raw = JSON.parse(text) } catch { throw new Error('这不是有效的备份文件') }
  const backup = backupSchema.parse(raw)
  const currentEvents = await database.events.toArray()
  await database.transaction('rw', database.contents, database.events, async () => {
    for (const pack of backup.contents) await saveContent(parseContentPack(pack), database)
    await database.events.bulkPut(mergeEvents(currentEvents, backup.events))
  })
  return backup
}

export async function clearLocalData(database: LearningDatabase = db): Promise<void> {
  await database.transaction('rw', database.contents, database.events, database.settings, async () => {
    await database.contents.clear()
    await database.events.clear()
    await database.settings.clear()
  })
}


import Dexie, { type EntityTable } from 'dexie'
import type { ContentPack } from '../domain/content'
import type { LearningEvent } from '../domain/events'

export interface StoredContent extends ContentPack {
  key: string
}

export interface AppSetting {
  key: string
  value: unknown
}

export class LearningDatabase extends Dexie {
  contents!: EntityTable<StoredContent, 'key'>
  events!: EntityTable<LearningEvent, 'eventId'>
  settings!: EntityTable<AppSetting, 'key'>

  constructor(name = 'fable-fragments') {
    super(name)
    this.version(1).stores({
      contents: 'key, contentId, version, status, domain',
      events: 'eventId, [userId+eventId], userId, syncStatus, studyDate, occurredAt, [contentId+contentVersion]',
      settings: 'key'
    })
  }
}

export const db = new LearningDatabase()


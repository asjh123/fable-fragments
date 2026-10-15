import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { parseContentPack, type ContentPack } from '../domain/content'
import type { LearningEvent } from '../domain/events'
import type { PulledEventsPage, RemoteSyncAdapter, SyncCursor } from './syncEngine'

const url = import.meta.env.VITE_SUPABASE_URL?.trim()
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()
export const ownerEmail = import.meta.env.VITE_OWNER_EMAIL?.trim().toLocaleLowerCase('en-US') ?? ''
export const cloudConfigured = Boolean(url && anonKey && !url.includes('your-project') && !anonKey.includes('your-public'))
export const supabase: SupabaseClient | null = cloudConfigured ? createClient(url, anonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }) : null

type RemoteRow = {
  event_id: string; user_id: string; device_id: string; event_type: LearningEvent['eventType']; content_id: string
  content_version: number; fragment_id: string | null; occurred_at: string; study_date: string; timezone: 'Asia/Shanghai'
  payload: Record<string, unknown>; schema_version: 1; client_created_at: string; created_at: string
}
function toRow(event: LearningEvent): Omit<RemoteRow, 'created_at'> {
  return { event_id: event.eventId, user_id: event.userId, device_id: event.deviceId, event_type: event.eventType, content_id: event.contentId, content_version: event.contentVersion, fragment_id: event.fragmentId, occurred_at: event.occurredAt, study_date: event.studyDate, timezone: event.timezone, payload: event.payload, schema_version: event.schemaVersion, client_created_at: event.createdAt }
}
function fromRow(row: RemoteRow): LearningEvent {
  return { eventId: row.event_id, userId: row.user_id, deviceId: row.device_id, eventType: row.event_type, contentId: row.content_id, contentVersion: row.content_version, fragmentId: row.fragment_id, occurredAt: row.occurred_at, studyDate: row.study_date, timezone: row.timezone, payload: row.payload ?? {}, schemaVersion: row.schema_version, createdAt: row.client_created_at, syncStatus: 'synced' }
}

export class SupabaseSyncAdapter implements RemoteSyncAdapter {
  constructor(private readonly client: SupabaseClient) {}
  async getUserId(): Promise<string | null> {
    const { data, error } = await this.client.auth.getUser()
    return error ? null : data.user?.id ?? null
  }
  async upload(events: LearningEvent[]) {
    const userId = await this.getUserId()
    if (!userId || events.some((event) => event.userId !== userId)) throw new Error('登录已失效，请重新登录后同步')
    const { error } = await this.client.from('learning_events').upsert(events.map(toRow), { onConflict: 'user_id,event_id', ignoreDuplicates: true })
    if (error) throw new Error('云端暂时无法接收学习记录')
  }
  async pull(cursor: SyncCursor | null, limit: number): Promise<PulledEventsPage> {
    const userId = await this.getUserId()
    if (!userId) return { events: [], cursor, hasMore: false }
    let query = this.client.from('learning_events').select('*').eq('user_id', userId).order('created_at', { ascending: true }).order('event_id', { ascending: true }).limit(limit)
    if (cursor) query = query.or(`created_at.gt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},event_id.gt.${cursor.eventId})`)
    const { data, error } = await query
    if (error) throw new Error('云端学习记录暂时无法读取')
    const rows = (data ?? []) as RemoteRow[]
    const last = rows.at(-1)
    return { events: rows.map(fromRow), cursor: last ? { createdAt: last.created_at, eventId: last.event_id } : cursor, hasMore: rows.length === limit }
  }
  async pullPublishedContents(): Promise<ContentPack[]> {
    const { data, error } = await this.client.from('content_packs').select('body').eq('status', 'published').order('content_id').order('version')
    if (error) throw new Error('云端学习内容暂时无法读取')
    return (data ?? []).map((row) => parseContentPack(row.body))
  }
}

export const remoteAdapter = supabase ? new SupabaseSyncAdapter(supabase) : null
export function normalizePublicAppUrl(configured: string | undefined, locationHref: string, baseUrl: string): string {
  const parsed = new URL(configured?.trim() || new URL(baseUrl, locationHref).href)
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('公开网址必须使用http或https')
  parsed.hash = ''; parsed.search = ''
  if (!parsed.pathname.endsWith('/')) parsed.pathname += '/'
  return parsed.href
}
export function isAllowedOwnerEmail(email: string, configuredOwner = ownerEmail) {
  return Boolean(configuredOwner) && email.trim().toLocaleLowerCase('en-US') === configuredOwner.trim().toLocaleLowerCase('en-US')
}
export async function sendMagicLink(email: string) {
  if (!supabase) throw new Error('当前没有配置云同步')
  const normalized = email.trim().toLocaleLowerCase('en-US')
  if (!isAllowedOwnerEmail(normalized)) throw new Error('登录请求无法完成，请检查配置后重试')
  const redirect = normalizePublicAppUrl(import.meta.env.VITE_PUBLIC_APP_URL, window.location.href, import.meta.env.BASE_URL)
  const { error } = await supabase.auth.signInWithOtp({ email: normalized, options: { emailRedirectTo: redirect, shouldCreateUser: false } })
  if (error) throw new Error('登录邮件发送失败，请检查邮箱后重试')
}
export async function signOut() { if (supabase) await supabase.auth.signOut() }

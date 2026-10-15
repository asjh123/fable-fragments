import type { SupabaseClient } from '@supabase/supabase-js'
import { contentKey, parseContentPack, type ContentPack } from '../domain/content'
import { calculateContentHash } from '../domain/contentHash'

export interface PublishResult { contentId: string; version: number; hash: string; created: boolean }
export interface ContentPublisher {
  publish(pack: ContentPack): Promise<PublishResult>
  verify(contentId: string, version: number, hash: string): Promise<boolean>
}

async function assertPublishable(input: unknown): Promise<ContentPack> {
  const pack = parseContentPack(input)
  if (pack.status !== 'published' || !pack.reviewedAt || !pack.publishedAt || !pack.contentHash) throw new Error('只有经过审核、带有效哈希的published内容才能发布')
  if (await calculateContentHash(pack) !== pack.contentHash) throw new Error('内容哈希不匹配，禁止发布被修改的版本')
  return pack
}

export class MemoryContentPublisher implements ContentPublisher {
  private readonly values = new Map<string, ContentPack>()
  async publish(input: ContentPack): Promise<PublishResult> {
    const pack = await assertPublishable(input)
    const key = contentKey(pack.contentId, pack.version)
    const existing = this.values.get(key)
    if (existing && existing.contentHash !== pack.contentHash) throw new Error('同一内容版本已存在且哈希不同，禁止覆盖')
    this.values.set(key, pack)
    return { contentId: pack.contentId, version: pack.version, hash: pack.contentHash, created: !existing }
  }
  async verify(contentId: string, version: number, hash: string) { return this.values.get(contentKey(contentId, version))?.contentHash === hash }
}

export class SupabaseContentPublisher implements ContentPublisher {
  constructor(private readonly client: SupabaseClient) {}
  async publish(input: ContentPack): Promise<PublishResult> {
    const pack = await assertPublishable(input)
    const { error } = await this.client.from('content_packs').insert({ content_id: pack.contentId, version: pack.version, status: 'published', body: pack })
    if (error) throw new Error('发布失败；为保护不可变版本，系统不会覆盖同名版本')
    if (!(await this.verify(pack.contentId, pack.version, pack.contentHash))) throw new Error('云端发布后哈希验证失败')
    return { contentId: pack.contentId, version: pack.version, hash: pack.contentHash, created: true }
  }
  async verify(contentId: string, version: number, hash: string) {
    const { data, error } = await this.client.from('content_packs').select('body').eq('content_id', contentId).eq('version', version).maybeSingle()
    return !error && data?.body?.contentHash === hash
  }
}

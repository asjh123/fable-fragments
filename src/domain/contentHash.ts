import type { ContentPack } from './content'

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return Object.fromEntries(Object.keys(record).sort().map((key) => [key, stable(record[key])]))
  }
  return value
}

export function stableContentJson(pack: ContentPack | Record<string, unknown>): string {
  const { contentHash: _hash, reviewedAt: _reviewed, publishedAt: _published, updatedAt: _updated, ...durable } = pack
  return JSON.stringify(stable(durable))
}

export async function calculateContentHash(pack: ContentPack | Record<string, unknown>): Promise<string> {
  const bytes = new TextEncoder().encode(stableContentJson(pack))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

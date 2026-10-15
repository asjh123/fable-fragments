import { mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { createServer } from 'vite'

function stable(value) {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]))
  return value
}

function hash(pack) {
  const { contentHash: _hash, reviewedAt: _reviewed, publishedAt: _published, updatedAt: _updated, ...durable } = pack
  return createHash('sha256').update(JSON.stringify(stable(durable))).digest('hex')
}

const root = resolve(import.meta.dirname, '..')
const server = await createServer({ root, server: { middlewareMode: true }, appType: 'custom' })
try {
  const { sampleContents } = await server.ssrLoadModule('/src/content/index.ts')
  const target = resolve(root, 'content-library', 'published')
  await mkdir(target, { recursive: true })
  for (const original of sampleContents) {
    const pack = {
      ...original,
      schemaVersion: 1,
      sourceReferences: original.sources,
      factClaims: [original.conceptExplanation],
      inferences: [original.engineeringTransfer],
      generatedAt: original.createdAt,
      reviewedAt: original.updatedAt,
      publishedAt: original.updatedAt,
      contentHash: ''
    }
    pack.contentHash = hash(pack)
    await writeFile(resolve(target, `${pack.contentId}-v${pack.version}.json`), `${JSON.stringify(pack, null, 2)}\n`, 'utf8')
  }
} finally {
  await server.close()
}

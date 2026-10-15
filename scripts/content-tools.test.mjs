import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import test from 'node:test'
const bayesianStory = JSON.parse(await readFile(new URL('../content-library/published/bell-tower-messenger-v1.json', import.meta.url), 'utf8'))
import { canonicalContent, contentHash, rebuildIndex, searchIndex, validateLoadedFiles } from './content-tools.mjs'

test('稳定哈希不受对象字段顺序影响，正文变化会改变哈希', () => {
  const reversed = Object.fromEntries(Object.entries(bayesianStory).reverse())
  assert.deepEqual(canonicalContent(reversed), canonicalContent(bayesianStory))
  assert.equal(contentHash(reversed), contentHash(bayesianStory))
  assert.notEqual(contentHash({ ...bayesianStory, conceptExplanation: `${bayesianStory.conceptExplanation}变化` }), contentHash(bayesianStory))
  assert.equal(contentHash({ ...bayesianStory, reviewedAt: '2030-01-01T00:00:00.000Z' }), contentHash(bayesianStory))
  assert.notEqual(contentHash({ ...bayesianStory, generatedAt: '2030-01-01T00:00:00.000Z' }), contentHash(bayesianStory))
})

test('拒绝重复版本和被静默修改的已发布内容', () => {
  const record = { pack: bayesianStory, relativePath: 'content-library/published/story.json' }
  assert.throws(() => validateLoadedFiles([record, record]), /重复内容版本/)
  assert.throws(() => validateLoadedFiles([{ ...record, pack: { ...bayesianStory, conceptExplanation: `${bayesianStory.conceptExplanation}变化` } }]), /哈希不匹配/)
})

test('SQLite索引可完整重建并全文检索', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'fable-index-'))
  const target = resolve(directory, 'catalog.sqlite')
  try {
    assert.equal(await rebuildIndex(target), 2)
    assert.ok(searchIndex('贝叶斯', target).some((row) => row.content_id === 'bell-tower-messenger'))
  } finally { await rm(directory, { recursive: true, force: true }) }
})

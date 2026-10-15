import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, stat } from 'node:fs/promises'
import { dirname, relative, resolve, sep } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { parseContentPack } from '../src/domain/content.ts'
import { stableContentJson } from '../src/domain/contentHash.ts'

export const projectRoot = resolve(import.meta.dirname, '..')
export const libraryRoot = resolve(projectRoot, 'content-library')
export const databasePath = resolve(projectRoot, 'local-data', 'catalog.sqlite')
const contentFolders = ['drafts', 'reviewed', 'published', 'rejected']

export function canonicalContent(pack) {
  return JSON.parse(stableContentJson(pack))
}

export function contentHash(pack) {
  return createHash('sha256').update(stableContentJson(pack)).digest('hex')
}

function assertInsideLibrary(path) {
  const rel = relative(libraryRoot, path)
  if (rel.startsWith(`..${sep}`) || rel === '..' || resolve(path) === libraryRoot) throw new Error(`内容路径越界：${path}`)
}

export async function loadContentFiles() {
  const results = []
  for (const folder of contentFolders) {
    const directory = resolve(libraryRoot, folder)
    assertInsideLibrary(resolve(directory, 'placeholder'))
    for (const name of await readdir(directory)) {
      if (!name.endsWith('.json')) continue
      const path = resolve(directory, name)
      assertInsideLibrary(path)
      if (!(await stat(path)).isFile()) continue
      let raw
      try { raw = JSON.parse(await readFile(path, 'utf8')) } catch (error) { throw new Error(`${relative(projectRoot, path)}：JSON无法解析：${error.message}`) }
      let pack
      try { pack = parseContentPack(raw) } catch (error) { throw new Error(`${relative(projectRoot, path)}：${error.message}`) }
      results.push({ pack, path, relativePath: relative(projectRoot, path).replaceAll('\\', '/') })
    }
  }
  return results
}

export async function validateLibrary() {
  const files = await loadContentFiles()
  validateLoadedFiles(files)
  return files
}

export function validateLoadedFiles(files) {
  const keys = new Set()
  for (const { pack, relativePath } of files) {
    const key = `${pack.contentId}@${pack.version}`
    if (keys.has(key)) throw new Error(`${relativePath}：重复内容版本 ${key}`)
    keys.add(key)
    const expectedFolder = pack.status === 'retired' ? 'published' : pack.status
    if (!relativePath.includes(`/content-library/${expectedFolder}/`) && !relativePath.includes(`content-library/${expectedFolder}/`)) throw new Error(`${relativePath}：文件目录与状态 ${pack.status} 不一致`)
    if (pack.status === 'published') {
      if (!pack.contentHash) throw new Error(`${relativePath}：已发布内容缺少contentHash`)
      const actual = contentHash(pack)
      if (actual !== pack.contentHash) throw new Error(`${relativePath}：已发布内容已变化，哈希不匹配`)
      if (!pack.publishedAt || !pack.reviewedAt) throw new Error(`${relativePath}：已发布内容缺少审核或发布时间`)
    }
    if (!pack.sourceReferences.length) throw new Error(`${relativePath}：缺少sourceReferences`)
  }
}

export async function rebuildIndex(target = databasePath) {
  const files = await validateLibrary()
  await mkdir(dirname(target), { recursive: true })
  const temporary = `${target}.next`
  await rm(temporary, { force: true })
  const database = new DatabaseSync(temporary)
  try {
    database.exec(`
      pragma journal_mode = WAL;
      create table contents (
        content_id text not null, version integer not null, status text not null, domain text not null,
        title text not null, source_path text not null, content_hash text not null,
        generated_at text not null, reviewed_at text, published_at text,
        primary key (content_id, version)
      );
      create table sources (
        source_id integer primary key, title text not null, publisher text not null, url text not null unique,
        source_type text not null, patent_publication_number text, retrieved_at text
      );
      create table content_sources (
        content_id text not null, version integer not null, source_id integer not null,
        primary key (content_id, version, source_id)
      );
      create virtual table contents_fts using fts5(content_id unindexed, version unindexed, title, domain, body);
    `)
    const insertContent = database.prepare('insert into contents values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    const insertSource = database.prepare('insert into sources (title, publisher, url, source_type, patent_publication_number, retrieved_at) values (?, ?, ?, ?, ?, ?) on conflict(url) do update set title=excluded.title returning source_id')
    const findSource = database.prepare('select source_id from sources where url = ?')
    const linkSource = database.prepare('insert or ignore into content_sources values (?, ?, ?)')
    const insertFts = database.prepare('insert into contents_fts values (?, ?, ?, ?, ?)')
    database.exec('begin')
    for (const { pack, relativePath } of files) {
      insertContent.run(pack.contentId, pack.version, pack.status, pack.domain, pack.revealedTitle, relativePath, pack.contentHash, pack.generatedAt, pack.reviewedAt, pack.publishedAt)
      const body = [pack.hiddenTitle, pack.revealedTitle, pack.conceptExplanation, pack.engineeringTransfer, ...pack.fragments.map((fragment) => `${fragment.title} ${fragment.body}`)].join('\n')
      insertFts.run(pack.contentId, pack.version, pack.revealedTitle, pack.domain, body)
      for (const source of pack.sourceReferences) {
        insertSource.get(source.title, source.publisher, source.url, source.sourceType, source.patentPublicationNumber ?? null, source.retrievedAt ?? null)
        const sourceId = findSource.get(source.url).source_id
        linkSource.run(pack.contentId, pack.version, sourceId)
      }
    }
    database.exec('commit')
  } catch (error) {
    try { database.exec('rollback') } catch { /* no active transaction */ }
    throw error
  } finally { database.close() }
  await rm(target, { force: true })
  await rename(temporary, target)
  return files.length
}

export function searchIndex(query, target = databasePath) {
  const keyword = query.trim()
  if (!keyword) throw new Error('请输入检索关键词')
  const database = new DatabaseSync(target, { readOnly: true })
  try {
    const statement = database.prepare("select content_id, version, title, domain, snippet(contents_fts, 4, '[', ']', '…', 18) as excerpt from contents_fts where contents_fts match ? order by rank limit 20")
    const ftsLiteral = `"${keyword.replaceAll('"', '""')}"`
    const exactMatches = statement.all(ftsLiteral)
    if (exactMatches.length) return exactMatches

    // SQLite内置unicode61分词器不会自动切分连续中文；使用参数化LIKE作为中文子串回退。
    const escaped = keyword.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')
    const pattern = `%${escaped}%`
    return database.prepare("select content_id, version, title, domain, substr(body, max(instr(body, ?) - 18, 1), 80) as excerpt from contents_fts where title like ? escape '\\' or domain like ? escape '\\' or body like ? escape '\\' limit 20")
      .all(keyword, pattern, pattern, pattern)
  } finally { database.close() }
}

async function main() {
  const command = process.argv[2]
  if (command === 'validate') console.log(`内容校验通过：${(await validateLibrary()).length}个版本`)
  else if (command === 'index') console.log(`索引重建完成：${await rebuildIndex()}个版本`)
  else if (command === 'search') {
    const rows = searchIndex(process.argv.slice(3).join(' '))
    if (!rows.length) console.log('没有匹配内容')
    for (const row of rows) console.log(`${row.content_id}@${row.version}｜${row.domain}｜${row.title}\n  ${row.excerpt}`)
  } else if (command === 'check') {
    const count = await rebuildIndex()
    console.log(`内容、哈希和SQLite重建检查通过：${count}个版本`)
  } else throw new Error('用法：node scripts/content-tools.mjs <validate|index|search|check> [关键词]')
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) main().catch((error) => { console.error(error.message); process.exitCode = 1 })

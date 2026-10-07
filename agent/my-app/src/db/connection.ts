import { Database } from 'bun:sqlite'
import fs from 'node:fs'
import path from 'node:path'

// 定位项目根的 resources/。本文件在 agent/my-app/src/db/ 下，往上是
// db → src → my-app → agent → 项目根，所以要退 **四** 层。
// 退少一层会指向 agent/my-app/resources —— 库会建在一个没人看的地方，
// 而且不报错：文件确实建出来了，只是前端永远读不到。
const resourcesDir = path.join(import.meta.dir, '../../../../resources')
const catalogPath = path.join(resourcesDir, 'catalog.sqlite')
const novelsDir = path.join(resourcesDir, 'novels')

export const NOVEL_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,47}$/
const CATALOG_SCHEMA = `CREATE TABLE IF NOT EXISTS novels (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL, genre TEXT NOT NULL DEFAULT '', style TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', logline TEXT NOT NULL DEFAULT '', target_words INTEGER NOT NULL DEFAULT 0, themes TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(themes)), status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','writing','paused','done')), created_at TEXT NOT NULL DEFAULT(datetime('now','localtime')), updated_at TEXT NOT NULL DEFAULT(datetime('now','localtime')))`
const NOVEL_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS worlds (id INTEGER PRIMARY KEY AUTOINCREMENT, version INTEGER NOT NULL UNIQUE, name TEXT NOT NULL, premise TEXT NOT NULL DEFAULT '', rules TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(rules)), factions TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(factions)), places TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(places)), terms TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(terms)), forbidden TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(forbidden)), created_at TEXT NOT NULL DEFAULT(datetime('now','localtime')), updated_at TEXT NOT NULL DEFAULT(datetime('now','localtime')))` ,
  `CREATE TABLE IF NOT EXISTS characters (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, role TEXT NOT NULL CHECK(role IN ('protagonist','antagonist','support')), immutable TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(immutable)), voice TEXT NOT NULL DEFAULT '', want TEXT NOT NULL DEFAULT '', cost TEXT NOT NULL DEFAULT '', need TEXT NOT NULL DEFAULT '', secret TEXT NOT NULL DEFAULT '', reveal TEXT NOT NULL DEFAULT '', line TEXT NOT NULL DEFAULT '', flaw TEXT NOT NULL DEFAULT '', arc_start TEXT NOT NULL DEFAULT '', arc_end TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'alive' CHECK(status IN ('alive','dead','disabled')), source TEXT NOT NULL DEFAULT 'agent' CHECK(source IN ('agent','hand')), created_at TEXT NOT NULL DEFAULT(datetime('now','localtime')), updated_at TEXT NOT NULL DEFAULT(datetime('now','localtime')))` ,
  `CREATE TABLE IF NOT EXISTS locations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, parent_id INTEGER REFERENCES locations(id) ON DELETE SET NULL, parent_raw TEXT NOT NULL DEFAULT '', signature TEXT NOT NULL DEFAULT '', features TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(features)), role TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT(datetime('now','localtime')), updated_at TEXT NOT NULL DEFAULT(datetime('now','localtime')))` ,
  `CREATE TABLE IF NOT EXISTS volumes (id INTEGER PRIMARY KEY AUTOINCREMENT, no INTEGER NOT NULL UNIQUE, name TEXT NOT NULL, goal TEXT NOT NULL DEFAULT '', from_state TEXT NOT NULL DEFAULT '', to_state TEXT NOT NULL DEFAULT '', start_chapter INTEGER NOT NULL, end_chapter INTEGER NOT NULL CHECK(end_chapter >= start_chapter), created_at TEXT NOT NULL DEFAULT(datetime('now','localtime')), updated_at TEXT NOT NULL DEFAULT(datetime('now','localtime')))` ,
  `CREATE TABLE IF NOT EXISTS outline_anchors (id INTEGER PRIMARY KEY CHECK(id = 1), logline TEXT NOT NULL, theme TEXT NOT NULL DEFAULT '', core_conflict TEXT NOT NULL DEFAULT '', ending_direction TEXT NOT NULL, structure_type TEXT NOT NULL, main_plot TEXT NOT NULL CHECK(json_valid(main_plot)), subplots TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(subplots)), locked_by_volume INTEGER, locked_at TEXT NOT NULL DEFAULT(datetime('now','localtime')))` ,
  `CREATE TABLE IF NOT EXISTS outline_volumes (id INTEGER PRIMARY KEY AUTOINCREMENT, volume_id INTEGER NOT NULL UNIQUE REFERENCES volumes(id) ON DELETE CASCADE, structure_type TEXT NOT NULL DEFAULT '', acts TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(acts)), turning_points TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(turning_points)), pacing TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(pacing)), constraints TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(constraints)), anchor_snapshot TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(anchor_snapshot)), created_at TEXT NOT NULL DEFAULT(datetime('now','localtime')), updated_at TEXT NOT NULL DEFAULT(datetime('now','localtime')))` ,
  `CREATE TABLE IF NOT EXISTS chapters (id INTEGER PRIMARY KEY AUTOINCREMENT, volume_id INTEGER NOT NULL REFERENCES volumes(id) ON DELETE CASCADE, idx INTEGER NOT NULL UNIQUE, title TEXT NOT NULL, goal TEXT NOT NULL DEFAULT '', conflict TEXT NOT NULL DEFAULT '', hook TEXT NOT NULL DEFAULT '', emotion TEXT NOT NULL DEFAULT '', summary TEXT NOT NULL DEFAULT '', place_raw TEXT NOT NULL DEFAULT '', place_id INTEGER REFERENCES locations(id) ON DELETE SET NULL, word_count_target INTEGER NOT NULL DEFAULT 3000, created_at TEXT NOT NULL DEFAULT(datetime('now','localtime')), updated_at TEXT NOT NULL DEFAULT(datetime('now','localtime')))` ,
  `CREATE TABLE IF NOT EXISTS chapter_cast (id INTEGER PRIMARY KEY AUTOINCREMENT, chapter_id INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE, raw TEXT NOT NULL, character_id INTEGER REFERENCES characters(id) ON DELETE SET NULL, resolved_at TEXT, UNIQUE(chapter_id, raw))`,
  `CREATE TABLE IF NOT EXISTS chapter_texts (id INTEGER PRIMARY KEY AUTOINCREMENT, chapter_id INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE, stage TEXT NOT NULL CHECK(stage IN ('draft','final')), text TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '', ends_with TEXT NOT NULL DEFAULT '', polish_report TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(polish_report)), created_at TEXT NOT NULL DEFAULT(datetime('now','localtime')), updated_at TEXT NOT NULL DEFAULT(datetime('now','localtime')), UNIQUE(chapter_id, stage))`,
  `CREATE TABLE IF NOT EXISTS generation_tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, stage TEXT NOT NULL CHECK(stage IN ('world','character','location','outline','chapter','polish')), target_key TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','done','failed','stale')), attempt INTEGER NOT NULL DEFAULT 0, input_hash TEXT NOT NULL DEFAULT '', artifact_path TEXT NOT NULL DEFAULT '', error TEXT NOT NULL DEFAULT '', started_at TEXT, finished_at TEXT, created_at TEXT NOT NULL DEFAULT(datetime('now','localtime')), updated_at TEXT NOT NULL DEFAULT(datetime('now','localtime')), UNIQUE(stage,target_key))`,
  `CREATE TABLE IF NOT EXISTS actor_decisions (id INTEGER PRIMARY KEY AUTOINCREMENT, chapter_id INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE, character_id INTEGER REFERENCES characters(id) ON DELETE SET NULL, situation TEXT NOT NULL, options TEXT NOT NULL CHECK(json_valid(options)), choice TEXT NOT NULL CHECK(choice IN ('A','B','C','D')), custom_answer TEXT NOT NULL DEFAULT '', reason TEXT NOT NULL DEFAULT '', line TEXT NOT NULL DEFAULT '', prompt_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT(datetime('now','localtime')), UNIQUE(chapter_id, character_id, prompt_hash))`,
  `CREATE TABLE IF NOT EXISTS memory_items (id INTEGER PRIMARY KEY AUTOINCREMENT, novel_id TEXT NOT NULL, stage TEXT NOT NULL DEFAULT 'L1' CHECK(stage IN ('L0','L1','L3')), layer TEXT NOT NULL CHECK(layer IN ('raw','fact','scene','world','character','plot','chapter')), title TEXT NOT NULL, content TEXT NOT NULL, source_type TEXT NOT NULL, source_id TEXT NOT NULL, volume_id INTEGER, chapter_id INTEGER, metadata TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(metadata)), embedding TEXT, created_at TEXT NOT NULL DEFAULT(datetime('now','localtime')), updated_at TEXT NOT NULL DEFAULT(datetime('now','localtime')), UNIQUE(novel_id, source_type, source_id))`,
  `CREATE VIRTUAL TABLE IF NOT EXISTS memory_items_fts USING fts5(title, content, content='memory_items', content_rowid='id', tokenize='unicode61')`,
  `CREATE TABLE IF NOT EXISTS character_portraits (id INTEGER PRIMARY KEY AUTOINCREMENT, novel_id TEXT NOT NULL, character_id INTEGER NOT NULL, version INTEGER NOT NULL, profile TEXT NOT NULL, tags TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(tags)), based_on_fact_ids TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(based_on_fact_ids)), memory_id INTEGER, updated_at TEXT NOT NULL DEFAULT(datetime('now','localtime')), UNIQUE(novel_id, character_id, version))`,
  `CREATE TABLE IF NOT EXISTS memory_jobs (id INTEGER PRIMARY KEY AUTOINCREMENT, memory_id INTEGER NOT NULL UNIQUE REFERENCES memory_items(id) ON DELETE CASCADE, novel_id TEXT NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload)), status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','done','failed')), attempts INTEGER NOT NULL DEFAULT 0, error TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT(datetime('now','localtime')), updated_at TEXT NOT NULL DEFAULT(datetime('now','localtime')))` ,
]

export const ensureStorageRoot = (): void => { fs.mkdirSync(novelsDir, { recursive: true }) }
const migrateCatalogSchema = (database: Database): void => {
  const columns = database.query('PRAGMA table_info(novels)').all() as Array<{ name: string }>
  const additions: Array<[string, string]> = [
    ['description', "TEXT NOT NULL DEFAULT ''"],
    ['logline', "TEXT NOT NULL DEFAULT ''"],
    ['target_words', 'INTEGER NOT NULL DEFAULT 0'],
    ['themes', "TEXT NOT NULL DEFAULT '[]'"],
  ]
  for (const [name, definition] of additions) {
    if (!columns.some((column) => column.name === name)) database.run(`ALTER TABLE novels ADD COLUMN ${name} ${definition}`)
  }
}
export const initializeCatalogSchema = (database: Database): void => {
  database.run('PRAGMA foreign_keys = ON')
  database.run(CATALOG_SCHEMA)
  migrateCatalogSchema(database)
}
export const openCatalogDatabase = (): Database => { ensureStorageRoot(); const database = new Database(catalogPath, { create: true }); initializeCatalogSchema(database); return database }
const migrateMemorySchema = (database: Database): void => {
  const columns = database.query('PRAGMA table_info(memory_items)').all() as Array<{ name: string }>
  if (!columns.some((column) => column.name === 'stage')) {
    database.run("ALTER TABLE memory_items ADD COLUMN stage TEXT NOT NULL DEFAULT 'L1'")
    database.run("UPDATE memory_items SET stage = CASE layer WHEN 'raw' THEN 'L0' ELSE 'L1' END")
  }
}
export const initializeNovelSchema = (database: Database): void => { database.run('PRAGMA foreign_keys = ON'); for (const ddl of NOVEL_SCHEMA) database.run(ddl); migrateMemorySchema(database) }
/**
 * 一本小说的数据目录。
 *
 * 单独抽出来是因为**删书要挪它** —— 路径规则和建库规则必须出自同一处，
 * 各写一份迟早会有一个写到别的地方去（`connection.ts` 退错层数就会把库
 * 建到没人读得到的地方，这个坑踩过）。
 */
export const novelDirectory = (slug: string): string => {
  if (!NOVEL_SLUG_PATTERN.test(slug)) throw new TypeError('小说 slug 不符合目录名规则')
  return path.join(novelsDir, slug)
}

export const openNovelDatabase = (slug: string): Database => { const novelDir = novelDirectory(slug); ensureStorageRoot(); fs.mkdirSync(novelDir, { recursive: true }); const database = new Database(path.join(novelDir, 'novel.sqlite'), { create: true }); initializeNovelSchema(database); return database }
export function withNovelDatabase<T>(slug: string, action: (database: Database) => T): T { const database = openNovelDatabase(slug); try { return action(database) } finally { database.close() } }

/**
 * 目录库里全部书。书架列表要用它；只拿到 chapterId 的接口（比如 PUT /api/chapters/:id）
 * 也要靠它挨本找——那种接口不带 novelId，没法直接定位到某一本书的库。
 */
export type CatalogNovel = {
  id: number
  slug: string
  title: string
  genre: string
  style: string
  status: string
  description: string
  logline: string
  target_words: number
  themes: string
  created_at: string
  updated_at: string
}

export const listNovelsInCatalog = (): CatalogNovel[] => {
  const catalog = openCatalogDatabase()
  try {
    return catalog.query('SELECT * FROM novels ORDER BY id').all() as CatalogNovel[]
  } finally { catalog.close() }
}

/** novelId → slug。查不到就直接失败，不要回落到"第一本"——那会在多本之间悄悄串档 */
export const slugOfNovel = (novelId: number): string => {
  const catalog = openCatalogDatabase()
  try {
    const row = catalog.query('SELECT slug FROM novels WHERE id = ?').get(novelId) as { slug: string } | null
    if (!row) throw new Error(`小说不存在：novelId=${novelId}`)
    return row.slug
  } finally { catalog.close() }
}

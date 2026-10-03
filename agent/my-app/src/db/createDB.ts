/**
 * 数据库连接 + 建表 + 迁移。
 *
 * 位置说明：本文件在 src/db/ 下，和 storyPlannerDB.ts 等放在一起。
 * 因为同目录，各 db 文件里的 import { db } from './createDB' 不用改。
 *
 * db 是模块级单例：整个应用共用这一个连接，模块只会被加载一次。
 *
 * ── 为什么事务封装也在这个文件里 ──
 * 本来想单独开 db/transaction.ts，但它要 import { db }，而 createDB 又要 import 它，
 * 就成环了。withTransaction 本来也只在说"这一个连接"的事，放这里最顺。
 * 各 db/service 文件 `import { db, withTransaction } from './createDB'` 即可。
 */
import { Database } from 'bun:sqlite'
import path from 'node:path'

// 用 import.meta.dir 定位，不写死盘符 —— 换电脑、换目录都不用改。
// src/db -> src -> my-app -> agent -> 墨灵，往上四层就是项目根。
const resourcesDir = path.join(import.meta.dir, '../../../../resources')
const dbPath = path.join(resourcesDir, 'myapp.sqlite')

export const db = new Database(dbPath, { create: true })

// SQLite 的外键检查默认是关的，必须每个连接手动打开，否则 REFERENCES 写了也不生效。
// 注意：这条 PRAGMA 在事务里是空操作，所以必须在任何事务之前执行。
db.run(`PRAGMA foreign_keys = ON`)

/* ==================== 事务 ==================== */

/**
 * 把一组写操作包成一个事务，抛异常就整体回滚。
 *
 * 为什么必须有：保存一卷大纲要同时写 volumes / outline_volumes / chapters /
 * chapter_cast / generation_tasks 五张表。没有事务的话，中途失败会留下一卷
 * 只有一半章节的库 —— 这种半成品比彻底失败更难查。
 *
 * bun:sqlite 的 db.transaction 支持嵌套（内层走 savepoint），所以可以放心套。
 */
export function withTransaction<T>(fn: () => T): T {
  return db.transaction(fn)()
}

/* ==================== 建表 ==================== */

const CREATE_NOVELS = `
  CREATE TABLE IF NOT EXISTS novels (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    slug       TEXT NOT NULL UNIQUE,
    title      TEXT NOT NULL,
    genre      TEXT NOT NULL DEFAULT '',
    style      TEXT NOT NULL DEFAULT '',
    status     TEXT NOT NULL DEFAULT 'draft'
               CHECK (status IN ('draft','writing','paused','done')),
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  )
`

const CREATE_WORLDS = `
  CREATE TABLE IF NOT EXISTS worlds (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    novel_id   INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
    version    INTEGER NOT NULL DEFAULT 1,
    name       TEXT NOT NULL,
    premise    TEXT NOT NULL,
    rules      TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(rules)),
    factions   TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(factions)),
    places     TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(places)),
    terms      TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(terms)),
    forbidden  TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(forbidden)),
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    UNIQUE(novel_id, version)
  )
`

// stage / status 两侧都用 CHECK 钉死，和 db/types/entity.ts 里的常量表一一对应。
// 常量表改了这里也要改 —— 这是有意的：改枚举应该是一次显式动作，不是随手加个字符串。
const CREATE_TASKS = `
  CREATE TABLE IF NOT EXISTS generation_tasks (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    novel_id      INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
    stage         TEXT NOT NULL
                  CHECK (stage IN ('world','character','location','outline','chapter','polish')),
    target_key    TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','running','done','failed','stale')),
    attempt       INTEGER NOT NULL DEFAULT 0,
    input_hash    TEXT NOT NULL DEFAULT '',
    artifact_path TEXT NOT NULL DEFAULT '',
    error         TEXT NOT NULL DEFAULT '',
    started_at    TEXT,
    finished_at   TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    UNIQUE(novel_id, stage, target_key)
  )
`

/* ==================== 内容层建表 ==================== */
// 这一批 10 张表都用同一种结构：novel_id 做外键 + ON DELETE CASCADE，
// 所以删一本小说就是把它的全部内容一起带走，不需要应用层逐表清理。

// 角色卡。arc 拆成两列：起点≠终点是这张卡有没有推进的判据，埋 JSON 里比不了。
// source 记"模型编的"还是"人定的"—— 主角是输入不是产物，得能分辨。
const CREATE_CHARACTERS = `
  CREATE TABLE IF NOT EXISTS characters (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    novel_id   INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    role       TEXT NOT NULL CHECK (role IN ('protagonist','antagonist','support')),
    immutable  TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(immutable)),
    voice      TEXT NOT NULL DEFAULT '',
    want       TEXT NOT NULL DEFAULT '',
    cost       TEXT NOT NULL DEFAULT '',
    need       TEXT NOT NULL DEFAULT '',
    secret     TEXT NOT NULL DEFAULT '',
    reveal     TEXT NOT NULL DEFAULT '',
    line       TEXT NOT NULL DEFAULT '',
    flaw       TEXT NOT NULL DEFAULT '',
    arc_start  TEXT NOT NULL DEFAULT '',
    arc_end    TEXT NOT NULL DEFAULT '',
    status     TEXT NOT NULL DEFAULT 'alive' CHECK (status IN ('alive','dead','disabled')),
    source     TEXT NOT NULL DEFAULT 'agent' CHECK (source IN ('agent','hand')),
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    UNIQUE(novel_id, name)
  )
`

// 关系网拆表，就为了这个外键：to_character_id 指向一个真实存在的角色。
// 9-30 那次角色卡里现编出 "protagonist" / "shen-wujiu-di" 这种 id，靠约束拦。
// to_raw 存卡上原样写的名字；解析不到就 NULL，那行就是"还没建的人"。
// 目标角色被删时 SET NULL（关系本身留着，退回未解析态），不是级联删掉。
const CREATE_CHARACTER_RELATIONS = `
  CREATE TABLE IF NOT EXISTS character_relations (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    novel_id          INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
    from_character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    to_raw            TEXT NOT NULL,
    to_character_id   INTEGER REFERENCES characters(id) ON DELETE SET NULL,
    attitude          TEXT NOT NULL DEFAULT '',
    resolved_at       TEXT,
    created_at        TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at        TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    UNIQUE(from_character_id, to_raw)
  )
`

// parent_id 自引用：子地点不可能挂在不存在的地点下。这是"层级挂载"的物理保证。
// 父地点被删时子地点 SET NULL 变成根，而不是跟着消失。
const CREATE_LOCATIONS = `
  CREATE TABLE IF NOT EXISTS locations (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    novel_id   INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    parent_raw TEXT NOT NULL DEFAULT '',
    parent_id  INTEGER REFERENCES locations(id) ON DELETE SET NULL,
    signature  TEXT NOT NULL DEFAULT '',
    features   TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(features)),
    role       TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    UNIQUE(novel_id, name)
  )
`

const CREATE_VOLUMES = `
  CREATE TABLE IF NOT EXISTS volumes (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    novel_id      INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
    no            INTEGER NOT NULL,
    name          TEXT NOT NULL,
    goal          TEXT NOT NULL DEFAULT '',
    from_state    TEXT NOT NULL DEFAULT '',
    to_state      TEXT NOT NULL DEFAULT '',
    start_chapter INTEGER NOT NULL,
    end_chapter   INTEGER NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    UNIQUE(novel_id, no),
    CHECK (end_chapter >= start_chapter)
  )
`

// 一本小说一行。novel_id 直接当主键，天然保证"只有一个锚点"。
const CREATE_OUTLINE_ANCHORS = `
  CREATE TABLE IF NOT EXISTS outline_anchors (
    novel_id         INTEGER PRIMARY KEY REFERENCES novels(id) ON DELETE CASCADE,
    logline          TEXT NOT NULL,
    theme            TEXT NOT NULL DEFAULT '',
    core_conflict    TEXT NOT NULL DEFAULT '',
    ending_direction TEXT NOT NULL,
    structure_type   TEXT NOT NULL,
    main_plot        TEXT NOT NULL CHECK (json_valid(main_plot)),
    subplots         TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(subplots)),
    locked_by_volume INTEGER,
    locked_at        TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  )
`

const CREATE_OUTLINE_VOLUMES = `
  CREATE TABLE IF NOT EXISTS outline_volumes (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    novel_id        INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
    volume_id       INTEGER NOT NULL REFERENCES volumes(id) ON DELETE CASCADE,
    structure_type  TEXT NOT NULL DEFAULT '',
    acts            TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(acts)),
    turning_points  TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(turning_points)),
    pacing          TEXT NOT NULL CHECK (json_valid(pacing)),
    constraints     TEXT NOT NULL CHECK (json_valid(constraints)),
    anchor_snapshot TEXT NOT NULL CHECK (json_valid(anchor_snapshot)),
    created_at      TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    UNIQUE(volume_id)
  )
`

// UNIQUE(novel_id, idx) ——「章节编号全篇连续、不从 1 重开」这条约定靠它兜底：
// 第二卷若从 1 重新编号，INSERT 会直接失败，而不是悄悄产生两条第 1 章。
const CREATE_CHAPTERS = `
  CREATE TABLE IF NOT EXISTS chapters (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    novel_id          INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
    volume_id         INTEGER NOT NULL REFERENCES volumes(id) ON DELETE CASCADE,
    idx               INTEGER NOT NULL,
    title             TEXT NOT NULL,
    goal              TEXT NOT NULL DEFAULT '',
    conflict          TEXT NOT NULL DEFAULT '',
    hook              TEXT NOT NULL DEFAULT '',
    emotion           TEXT NOT NULL DEFAULT '',
    summary           TEXT NOT NULL DEFAULT '',
    place_raw         TEXT NOT NULL DEFAULT '',
    place_id          INTEGER REFERENCES locations(id) ON DELETE SET NULL,
    word_count_target INTEGER NOT NULL DEFAULT 3000,
    created_at        TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at        TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    UNIQUE(novel_id, idx)
  )
`

// 待建清单就住在这张表里：character_id IS NULL 的行 = 这一章要的人还没建。
const CREATE_CHAPTER_CAST = `
  CREATE TABLE IF NOT EXISTS chapter_cast (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    novel_id     INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
    chapter_id   INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
    raw          TEXT NOT NULL,
    character_id INTEGER REFERENCES characters(id) ON DELETE SET NULL,
    resolved_at  TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    UNIQUE(chapter_id, raw)
  )
`

// 一章最多两行（draft / final）。重跑 UPSERT 覆盖，不堆历史版本。
// 不存 word_count：SQLite 的 length(text) 对 UTF-8 就是中文字数。
const CREATE_CHAPTER_TEXTS = `
  CREATE TABLE IF NOT EXISTS chapter_texts (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    novel_id      INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
    chapter_id    INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
    stage         TEXT NOT NULL CHECK (stage IN ('draft','final')),
    text          TEXT NOT NULL,
    summary       TEXT NOT NULL DEFAULT '',
    ends_with     TEXT NOT NULL DEFAULT '',
    polish_report TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(polish_report)),
    created_at    TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    UNIQUE(chapter_id, stage)
  )
`

const CREATE_ACTOR_DECISIONS = `
  CREATE TABLE IF NOT EXISTS actor_decisions (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    novel_id      INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
    chapter_id    INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
    character_id  INTEGER REFERENCES characters(id) ON DELETE SET NULL,
    situation     TEXT NOT NULL,
    options       TEXT NOT NULL CHECK (json_valid(options)),
    choice        TEXT NOT NULL CHECK (choice IN ('A','B','C','D')),
    custom_answer TEXT NOT NULL DEFAULT '',
    reason        TEXT NOT NULL DEFAULT '',
    line          TEXT NOT NULL DEFAULT '',
    prompt_hash   TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    UNIQUE(chapter_id, character_id, prompt_hash)
  )
`

/* ==================== 迁移 ==================== */

/** 读一张表现有的列名。表不存在返回空数组。表名只从本文件的常量来，不是用户输入 */
const columnNames = (table: string): string[] =>
  (db.query(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name)

/**
 * worlds 从「无外键、无 version」迁到「有外键、有 version」。
 *
 * SQLite 不支持 ALTER TABLE ADD CONSTRAINT，加外键只能重建表（官方 12 步法）。
 * 这里做的是简化版：改名 → 建新 → 拷数据 → 删旧，包在一个事务里。
 *
 * 幂等：只要 version 列已存在就直接返回，重复启动不会重复搬。
 */
const ensureWorlds = (): void => {
  const cols = columnNames('worlds')
  if (cols.length === 0) {
    db.run(CREATE_WORLDS)
    return
  }
  if (cols.includes('version')) return

  const legacy = db.query(`SELECT count(*) AS c FROM worlds`).get() as { c: number }
  let copied = 0

  db.transaction(() => {
    db.run(`ALTER TABLE worlds RENAME TO worlds_legacy`)
    db.run(CREATE_WORLDS)

    // 只搬 novel_id 能在 novels 里找到的行 —— 新表有外键，孤立的 novel_id 会被拒。
    // 老库里 novel_id 是随手传的数字，这次补齐 novels 表之后才第一次有得可校验。
    copied = db.run(`
      INSERT INTO worlds
        (id, novel_id, version, name, premise, rules, factions, places, terms, forbidden, created_at, updated_at)
      SELECT w.id, w.novel_id, 1, w.name, w.premise, w.rules, w.factions,
             w.places, w.terms, w.forbidden, w.created_at, w.updated_at
      FROM worlds_legacy w
      WHERE EXISTS (SELECT 1 FROM novels n WHERE n.id = w.novel_id)
    `).changes

    db.run(`DROP TABLE worlds_legacy`)
  })()

  if (copied !== legacy.c) {
    // 不静默丢数据：说清楚丢了几条、为什么丢、怎么补救
    console.error(
      `[migrate] worlds 重建：${legacy.c} 行里有 ${legacy.c - copied} 行的 novel_id ` +
        `在 novels 表里不存在，已被丢弃。如果这些数据还要，先把对应的 novels 行补上再重启。`,
    )
  }
  console.log(`[migrate] worlds 已重建：加 version 列 + 外键到 novels，搬迁 ${copied} 行`)
}

/* ==================== 执行 ==================== */

/**
 * 建表顺序 = 依赖顺序，不能随便调。
 *
 * 凡是 REFERENCES 别人的表都得排在别人后面：characters 和 locations 排在
 * character_relations 前面，volumes 排在 outline_volumes / chapters 前面，
 * chapters 排在 chapter_cast / chapter_texts / actor_decisions 前面。
 * novels 排最前（几乎所有表都引用它）。
 */
const CONTENT_TABLES = [
  CREATE_CHARACTERS,
  CREATE_CHARACTER_RELATIONS,
  CREATE_LOCATIONS,
  CREATE_VOLUMES,
  CREATE_OUTLINE_ANCHORS,
  CREATE_OUTLINE_VOLUMES,
  CREATE_CHAPTERS,
  CREATE_CHAPTER_CAST,
  CREATE_CHAPTER_TEXTS,
  CREATE_ACTOR_DECISIONS,
]

db.run(CREATE_NOVELS)
ensureWorlds()
for (const ddl of CONTENT_TABLES) db.run(ddl)
db.run(CREATE_TASKS)

// datetime('now') 存的是 UTC，比北京时间早 8 小时，所以各表的默认值都加了 'localtime'。
// 外键列不会自动建索引，常用的查询路径手动补上。
// UNIQUE 约束自带的索引不在这里重复建（如 chapters(novel_id, idx) 已被 UNIQUE 覆盖）。
const INDEXES = [
  `CREATE INDEX IF NOT EXISTS idx_worlds_novel ON worlds(novel_id)`,
  `CREATE INDEX IF NOT EXISTS idx_tasks_novel_status ON generation_tasks(novel_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_characters_novel ON characters(novel_id)`,
  // 两张查关系：从谁出发（拆卡时用）、指向谁（查"谁提到过我"）
  `CREATE INDEX IF NOT EXISTS idx_rel_from ON character_relations(from_character_id)`,
  `CREATE INDEX IF NOT EXISTS idx_rel_to ON character_relations(to_character_id)`,
  `CREATE INDEX IF NOT EXISTS idx_locations_novel ON locations(novel_id)`,
  `CREATE INDEX IF NOT EXISTS idx_locations_parent ON locations(parent_id)`,
  `CREATE INDEX IF NOT EXISTS idx_volumes_novel ON volumes(novel_id)`,
  `CREATE INDEX IF NOT EXISTS idx_outline_volumes_novel ON outline_volumes(novel_id)`,
  `CREATE INDEX IF NOT EXISTS idx_chapters_volume ON chapters(volume_id, idx)`,
  `CREATE INDEX IF NOT EXISTS idx_cast_character ON chapter_cast(character_id)`,
  `CREATE INDEX IF NOT EXISTS idx_decisions_chapter ON actor_decisions(chapter_id)`,
]
for (const sql of INDEXES) db.run(sql)

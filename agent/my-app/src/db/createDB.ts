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

// 顺序有依赖：worlds 和 generation_tasks 都 REFERENCES novels，所以 novels 必须先建。
db.run(CREATE_NOVELS)
ensureWorlds()
db.run(CREATE_TASKS)

// datetime('now') 存的是 UTC，比北京时间早 8 小时，所以各表的默认值都加了 'localtime'。
// 外键列不会自动建索引，按 novel_id 查的两处都手动补上。
db.run(`CREATE INDEX IF NOT EXISTS idx_worlds_novel ON worlds(novel_id)`)
db.run(`CREATE INDEX IF NOT EXISTS idx_tasks_novel_status ON generation_tasks(novel_id, status)`)

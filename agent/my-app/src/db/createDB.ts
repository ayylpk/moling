/**
 * 数据库连接 + 建表。
 *
 * 位置说明：本文件已从 src/ 移到 src/db/ 下，和 storyPlannerDB.ts 放在一起。
 * 因为两个文件同目录，storyPlannerDB.ts 里的 import { db } from './createDB' 不用改。
 *
 * db 是模块级单例：整个应用共用这一个连接，模块只会被加载一次。
 */
import { Database } from 'bun:sqlite'
import path from 'node:path'

// 用 import.meta.dir 定位，不写死盘符 —— 换电脑、换目录都不用改。
// src/db -> src -> my-app -> agent -> 墨灵，往上四层就是项目根。
const resourcesDir = path.join(import.meta.dir, '../../../../resources')
const dbPath = path.join(resourcesDir, 'myapp.sqlite')

export const db = new Database(dbPath, { create: true })

// SQLite 的外键检查默认是关的，必须每个连接手动打开，否则 REFERENCES 写了也不生效。
// 目前 worlds.novel_id 还没加外键约束，这行先放着 —— 以后加 REFERENCES novels(id) 就靠它。
db.run(`PRAGMA foreign_keys = ON`)

db.run(`
  CREATE TABLE IF NOT EXISTS worlds (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    novel_id   INTEGER NOT NULL,
    premise    TEXT NOT NULL,
    rules      TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(rules)),
    factions   TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(factions)),
    places     TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(places)),
    terms      TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(terms)),
    forbidden  TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(forbidden)),
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  )
`)

// datetime('now') 存的是 UTC，比北京时间早 8 小时，所以上面两处都加了 'localtime'。
// 另外让按 novel_id 查走索引 —— 外键列不会自动建索引。
db.run(`CREATE INDEX IF NOT EXISTS idx_worlds_novel ON worlds(novel_id)`)

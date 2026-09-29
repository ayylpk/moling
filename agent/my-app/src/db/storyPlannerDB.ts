/**
 * 世界观（worlds 表）的数据库访问层。
 *
 * 这一层只做三件事：拼 SQL、读/写 JSON 文本、返回 Entity。
 * 不做校验、不补默认值、不转 VO —— 那些是 service 的事。
 *
 * 所有函数返回的都是 Entity 形态：rules / factions / ... 是 JSON 字符串，不是数组。
 */
import { db } from './createDB'
import type { WorldEntity, WorldBriefVO } from '../../../db/types'

/* ==================== 入参类型 ==================== */

/** 插入用的行数据：id 自增，created_at / updated_at 由数据库默认值生成 */
export type NewWorldRow = Omit<WorldEntity, 'id' | 'created_at' | 'updated_at'>

/** 更新用的补丁：只放要改的字段。数组字段这里要传 JSON 字符串 */
export type WorldRowPatch = Partial<Omit<WorldEntity, 'id' | 'created_at'>>

/* ==================== 字段白名单 ==================== */
// 字段名是要拼进 SQL 的，所以只能从这两个白名单里取，
// 不能直接用传入对象的 key —— 否则就是注入口子。
const TEXT_KEYS = ['name', 'premise', 'updated_at'] as const
const JSON_KEYS = ['rules', 'factions', 'places', 'terms', 'forbidden'] as const

/* ==================== 预编译语句 ==================== */
// 放在模块级：只 prepare 一次，之后每次调用复用。
// db.query() 每次调用都会重新编译 SQL，别写在函数体里。
const stmtInsert = db.query(`
  INSERT INTO worlds (novel_id, name, premise, rules, factions, places, terms, forbidden)
  VALUES ($novel_id, $name, $premise, $rules, $factions, $places, $terms, $forbidden)
`)
const stmtSelectById = db.query(`SELECT * FROM worlds WHERE id = ?`)
const stmtSelectAll = db.query(`SELECT * FROM worlds ORDER BY id DESC`)
const stmtSelectByNovel = db.query(`SELECT * FROM worlds WHERE novel_id = ? ORDER BY id DESC`)
const stmtDelete = db.query(`DELETE FROM worlds WHERE id = ?`)

/* ==================== 增 ==================== */

/** 插入一行，返回新的 id */
export const insertWorld = (row: NewWorldRow): number => {
  const info = stmtInsert.run({
    $novel_id: row.novel_id,
    $name: row.name,
    $premise: row.premise,
    $rules: row.rules,
    $factions: row.factions,
    $places: row.places,
    $terms: row.terms,
    $forbidden: row.forbidden,
  })
  return Number(info.lastInsertRowid)
}

/* ==================== 查 ==================== */

export const selectWorld = (id: number): WorldEntity | null =>
  stmtSelectById.get(id) as WorldEntity | null

export const selectWorlds = (): WorldEntity[] =>
  stmtSelectAll.all() as WorldEntity[]

export const selectWorldsByNovel = (novelId: number): WorldEntity[] =>
  stmtSelectByNovel.all(novelId) as WorldEntity[]

/** 列表精简查询：不拉那 5 个大 JSON，只给规则条数。返回形状正好是 WorldBriefVO */
export const selectWorldBriefsByNovel = (novelId: number): WorldBriefVO[] =>
  db.query(`
    SELECT id, novel_id, name, premise,
           json_array_length(rules) AS ruleCount
    FROM worlds
    WHERE novel_id = ?
    ORDER BY id DESC
  `).all(novelId) as WorldBriefVO[]

/** 在规则文本里搜关键词 —— 在 SQL 层筛，不用全表拉到内存再 filter */
export const selectWorldsByRule = (keyword: string): WorldBriefVO[] =>
  db.query(`
    SELECT id, novel_id, name, premise,
           json_array_length(rules) AS ruleCount
    FROM worlds
    WHERE EXISTS (
      SELECT 1 FROM json_each(worlds.rules)
      WHERE json_extract(value, '$.text') LIKE $kw
    )
    ORDER BY id DESC
  `).all({ $kw: `%${keyword}%` }) as WorldBriefVO[]

/* ==================== 改 ==================== */

/** 只更新补丁里出现的字段，返回受影响行数 */
export const updateWorldRow = (id: number, patch: WorldRowPatch): number => {
  const sets: string[] = []
  const params: Record<string, string | number> = { $id: id }

  for (const key of TEXT_KEYS) {
    const v = patch[key]
    if (v !== undefined) {
      sets.push(`${key} = $${key}`)
      params[`$${key}`] = v
    }
  }
  for (const key of JSON_KEYS) {
    const v = patch[key]
    if (v !== undefined) {
      sets.push(`${key} = $${key}`)
      params[`$${key}`] = v
    }
  }

  // 补丁是空的就别发一条空 UPDATE
  if (sets.length === 0) return 0
  return db.query(`UPDATE worlds SET ${sets.join(', ')} WHERE id = $id`).run(params).changes
}

/* ==================== 删 ==================== */

/** 返回受影响行数，0 表示本来就没这条 */
export const deleteWorld = (id: number): number => stmtDelete.run(id).changes

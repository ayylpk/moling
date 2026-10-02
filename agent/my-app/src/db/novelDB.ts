/**
 * 小说（novels 表）的数据库访问层。
 *
 * 这一层只做三件事：拼 SQL、读/写、返回 Entity。
 * 不做校验、不补默认值、不转 VO —— 那些是 service 的事。
 *
 * novels 没有 JSON 列，所以这里不涉及 stringify / JSON.parse。
 */
import { db } from './createDB'
import type { NovelEntity, NovelStatus } from '../../../db/types'

/* ==================== 入参类型 ==================== */

/** 插入用的行数据：id 自增，created_at / updated_at 由数据库默认值生成 */
export type NewNovelRow = Omit<NovelEntity, 'id' | 'created_at' | 'updated_at'>

/** 更新用的补丁：只放要改的字段 */
export type NovelRowPatch = Partial<Omit<NovelEntity, 'id' | 'created_at'>>

/* ==================== 字段白名单 ==================== */
// 字段名是要拼进 SQL 的，所以只能从这个白名单里取，
// 不能直接用传入对象的 key —— 否则就是注入口子。
const TEXT_KEYS = ['slug', 'title', 'genre', 'style', 'status', 'updated_at'] as const

/* ==================== 预编译语句 ==================== */
// 放在模块级：只 prepare 一次，之后每次调用复用。
// db.query() 每次调用都会重新编译 SQL，别写在函数体里。
const stmtInsert = db.query(`
  INSERT INTO novels (slug, title, genre, style, status)
  VALUES ($slug, $title, $genre, $style, $status)
`)
const stmtSelectById = db.query(`SELECT * FROM novels WHERE id = ?`)
const stmtSelectBySlug = db.query(`SELECT * FROM novels WHERE slug = ?`)
const stmtSelectAll = db.query(`SELECT * FROM novels ORDER BY id DESC`)
const stmtSelectByStatus = db.query(`SELECT * FROM novels WHERE status = ? ORDER BY id DESC`)
const stmtDelete = db.query(`DELETE FROM novels WHERE id = ?`)

/* ==================== 增 ==================== */

/** 插入一行，返回新的 id。slug 撞了就抛 SqliteError（UNIQUE 约束），由 service 翻译成人话 */
export const insertNovel = (row: NewNovelRow): number => {
  const info = stmtInsert.run({
    $slug: row.slug,
    $title: row.title,
    $genre: row.genre,
    $style: row.style,
    $status: row.status,
  })
  return Number(info.lastInsertRowid)
}

/* ==================== 查 ==================== */

export const selectNovel = (id: number): NovelEntity | null =>
  stmtSelectById.get(id) as NovelEntity | null

export const selectNovelBySlug = (slug: string): NovelEntity | null =>
  stmtSelectBySlug.get(slug) as NovelEntity | null

export const selectNovels = (): NovelEntity[] => stmtSelectAll.all() as NovelEntity[]

export const selectNovelsByStatus = (status: NovelStatus): NovelEntity[] =>
  stmtSelectByStatus.all(status) as NovelEntity[]

/* ==================== 改 ==================== */

/** 只更新补丁里出现的字段，返回受影响行数 */
export const updateNovelRow = (id: number, patch: NovelRowPatch): number => {
  const sets: string[] = []
  const params: Record<string, string | number> = { $id: id }

  for (const key of TEXT_KEYS) {
    const v = patch[key]
    if (v !== undefined) {
      sets.push(`${key} = $${key}`)
      params[`$${key}`] = v
    }
  }

  // 补丁是空的就别发一条空 UPDATE
  if (sets.length === 0) return 0
  return db.query(`UPDATE novels SET ${sets.join(', ')} WHERE id = $id`).run(params).changes
}

/* ==================== 删 ==================== */

/**
 * 返回受影响行数，0 表示本来就没这条。
 *
 * 注意：这条会连带删掉该小说下的 worlds 和 generation_tasks（外键 ON DELETE CASCADE）。
 * 所以 service 里删之前应该先问一句，别让调用方误触。
 */
export const deleteNovel = (id: number): number => stmtDelete.run(id).changes

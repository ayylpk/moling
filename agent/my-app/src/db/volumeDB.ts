/**
 * 卷（volumes）的数据库访问层。
 *
 * 一卷是"一次产出"的边界：中心 agent 逐卷调 Architect，跑完一卷落一卷。
 *
 * `start_chapter` / `end_chapter` 是显式存的，不是从 chapters 推的 ——
 * 第二卷还没生成章节时，卷表仍要能表达"第 51–100 章"。这不可推导。
 *
 * 表上**没有 status 列**：这一卷到哪一步了，看 outline_volumes 存不存在、
 * 它的章节有没有 final 正文。存一份状态副本只会和事实不同步。
 */
import { db } from './createDB'
import type { VolumeEntity } from '../../../db/types'

/* ==================== 入参类型 ==================== */

export type NewVolumeRow = Omit<VolumeEntity, 'id' | 'created_at' | 'updated_at'>
export type VolumeRowPatch = Partial<Omit<VolumeEntity, 'id' | 'novel_id' | 'created_at'>>

/* ==================== 字段白名单 ==================== */
const TEXT_KEYS = ['name', 'goal', 'from_state', 'to_state', 'updated_at'] as const
const NUM_KEYS = ['no', 'start_chapter', 'end_chapter'] as const

/* ==================== 预编译语句 ==================== */

const stmtInsert = db.query(`
  INSERT INTO volumes (novel_id, no, name, goal, from_state, to_state, start_chapter, end_chapter)
  VALUES ($novel_id, $no, $name, $goal, $from_state, $to_state, $start_chapter, $end_chapter)
`)
const stmtSelectById = db.query(`SELECT * FROM volumes WHERE id = ?`)
const stmtSelectByNo = db.query(`SELECT * FROM volumes WHERE novel_id = ? AND no = ?`)
const stmtSelectByNovel = db.query(`SELECT * FROM volumes WHERE novel_id = ? ORDER BY no`)
const stmtDelete = db.query(`DELETE FROM volumes WHERE id = ?`)

/* ==================== 增 ==================== */

export const insertVolume = (row: NewVolumeRow): number =>
  Number(
    stmtInsert.run({
      $novel_id: row.novel_id,
      $no: row.no,
      $name: row.name,
      $goal: row.goal,
      $from_state: row.from_state,
      $to_state: row.to_state,
      $start_chapter: row.start_chapter,
      $end_chapter: row.end_chapter,
    }).lastInsertRowid,
  )

/* ==================== 查 ==================== */

export const selectVolume = (id: number): VolumeEntity | null =>
  stmtSelectById.get(id) as VolumeEntity | null

export const selectVolumeByNo = (novelId: number, no: number): VolumeEntity | null =>
  stmtSelectByNo.get(novelId, no) as VolumeEntity | null

export const selectVolumesByNovel = (novelId: number): VolumeEntity[] =>
  stmtSelectByNovel.all(novelId) as VolumeEntity[]

/** 该小说已有的最大卷号，一卷都没有时返回 0 */
export const selectMaxVolumeNo = (novelId: number): number =>
  (db.query(`SELECT coalesce(max(no), 0) AS v FROM volumes WHERE novel_id = ?`).get(novelId) as {
    v: number
  }).v

/**
 * 列表 + hasOutline 标志。
 *
 * 那个 EXISTS 就是"这一卷的大纲建了没"的答案 —— 不存状态列，现算。
 * 卷数很少（一本几卷），这点开销可以忽略。
 */
export const selectVolumesWithOutline = (novelId: number): (VolumeEntity & { hasOutline: number })[] =>
  db
    .query(`
      SELECT v.*,
             EXISTS (SELECT 1 FROM outline_volumes o WHERE o.volume_id = v.id) AS hasOutline
      FROM volumes v
      WHERE v.novel_id = ?
      ORDER BY v.no
    `)
    .all(novelId) as (VolumeEntity & { hasOutline: number })[]

/** 这一卷的大纲建了没 */
export const selectOutlineVolumeFlag = (volumeId: number): boolean =>
  (db
    .query(`SELECT EXISTS (SELECT 1 FROM outline_volumes WHERE volume_id = ?) AS f`)
    .get(volumeId) as { f: number }).f === 1

/* ==================== 改 ==================== */

export const updateVolumeRow = (id: number, patch: VolumeRowPatch): number => {
  const sets: string[] = []
  const params: Record<string, string | number> = { $id: id }

  for (const key of TEXT_KEYS) {
    const v = patch[key]
    if (v !== undefined) {
      sets.push(`${key} = $${key}`)
      params[`$${key}`] = v
    }
  }
  for (const key of NUM_KEYS) {
    const v = patch[key]
    if (v !== undefined) {
      sets.push(`${key} = $${key}`)
      params[`$${key}`] = v
    }
  }

  if (sets.length === 0) return 0
  return db.query(`UPDATE volumes SET ${sets.join(', ')} WHERE id = $id`).run(params).changes
}

/* ==================== 删 ==================== */

/** 返回受影响行数。大纲与章节会因为外键级联一起删掉 */
export const deleteVolume = (id: number): number => stmtDelete.run(id).changes

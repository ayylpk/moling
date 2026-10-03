/**
 * 大纲（outline_anchors + outline_volumes）的数据库访问层。
 *
 * 分两张表是为了把「全篇级」和「卷级」拆开：
 *
 *   outline_anchors  —— 全篇锚点，一本小说一行，第一卷定稿后每卷原样回填
 *   outline_volumes  —— 本卷的幕 / 转折点 / 节奏 / 约束 + **回填的锚点副本**
 *
 * 为什么要那份副本：锚点漂移的检查就是「本卷回填的锚点」和「当前锚点」
 * 逐字比。有了 outline_volumes.anchor_snapshot，这事一条查询就能做；
 * 没有它就只能靠人眼，而人眼看不出一卷里 logline 被改了一个词。
 */
import { db } from './createDB'
import type { OutlineAnchorEntity, OutlineVolumeEntity } from '../../../db/types'

/* ==================== 入参类型 ==================== */

/** locked_at 由数据库默认值生成，调用方不填 */
export type NewAnchorRow = Omit<OutlineAnchorEntity, 'locked_at'>
export type AnchorRowPatch = Partial<Omit<OutlineAnchorEntity, 'novel_id' | 'locked_at'>>

export type NewOutlineVolumeRow = Omit<OutlineVolumeEntity, 'id' | 'created_at' | 'updated_at'>
export type OutlineVolumeRowPatch = Partial<Omit<OutlineVolumeEntity, 'id' | 'novel_id' | 'volume_id' | 'created_at'>>

/* ==================== 字段白名单 ==================== */
const ANCHOR_TEXT_KEYS = ['logline', 'theme', 'core_conflict', 'ending_direction', 'structure_type'] as const
const ANCHOR_JSON_KEYS = ['main_plot', 'subplots'] as const

const VOL_TEXT_KEYS = ['structure_type', 'updated_at'] as const
const VOL_JSON_KEYS = ['acts', 'turning_points', 'pacing', 'constraints', 'anchor_snapshot'] as const

/* ==================== 预编译语句 ==================== */

const stmtUpsertAnchor = db.query(`
  INSERT INTO outline_anchors
    (novel_id, logline, theme, core_conflict, ending_direction, structure_type, main_plot, subplots, locked_by_volume)
  VALUES
    ($novel_id, $logline, $theme, $core_conflict, $ending_direction, $structure_type, $main_plot, $subplots, $locked_by_volume)
  ON CONFLICT(novel_id) DO UPDATE SET
    logline          = excluded.logline,
    theme            = excluded.theme,
    core_conflict    = excluded.core_conflict,
    ending_direction = excluded.ending_direction,
    structure_type   = excluded.structure_type,
    main_plot        = excluded.main_plot,
    subplots         = excluded.subplots,
    locked_by_volume = excluded.locked_by_volume,
    locked_at        = datetime('now', 'localtime')
`)
const stmtSelectAnchor = db.query(`SELECT * FROM outline_anchors WHERE novel_id = ?`)
const stmtDeleteAnchor = db.query(`DELETE FROM outline_anchors WHERE novel_id = ?`)

const stmtInsertOutlineVolume = db.query(`
  INSERT INTO outline_volumes
    (novel_id, volume_id, structure_type, acts, turning_points, pacing, constraints, anchor_snapshot)
  VALUES
    ($novel_id, $volume_id, $structure_type, $acts, $turning_points, $pacing, $constraints, $anchor_snapshot)
`)
const stmtSelectOutlineVolume = db.query(`SELECT * FROM outline_volumes WHERE volume_id = ?`)
const stmtSelectOutlineVolumesByNovel = db.query(
  `SELECT * FROM outline_volumes WHERE novel_id = ? ORDER BY volume_id`,
)
const stmtDeleteOutlineVolume = db.query(`DELETE FROM outline_volumes WHERE volume_id = ?`)

/* ==================== 锚点 ==================== */

/**
 * 写锚点。**只在第一卷调用**。
 *
 * 用 UPSERT 而不是纯 INSERT：万一第一次写失败了，重跑要能覆盖，
 * 而不是撞 UNIQUE 报错卡住。但**正常的第二卷起不该调这个函数** ——
 * 锚点是逐字回填的，不是重写的。
 */
export const upsertAnchor = (row: NewAnchorRow): void => {
  stmtUpsertAnchor.run({
    $novel_id: row.novel_id,
    $logline: row.logline,
    $theme: row.theme,
    $core_conflict: row.core_conflict,
    $ending_direction: row.ending_direction,
    $structure_type: row.structure_type,
    $main_plot: row.main_plot,
    $subplots: row.subplots,
    $locked_by_volume: row.locked_by_volume,
  })
}

export const selectAnchor = (novelId: number): OutlineAnchorEntity | null =>
  stmtSelectAnchor.get(novelId) as OutlineAnchorEntity | null

/** 改锚点（比如错别字）。改内容应该重跑第一卷，不该走这里 */
export const updateAnchorRow = (novelId: number, patch: AnchorRowPatch): number => {
  const sets: string[] = []
  const params: Record<string, string | number | null> = { $novel_id: novelId }

  for (const key of ANCHOR_TEXT_KEYS) {
    const v = patch[key]
    if (v !== undefined) {
      sets.push(`${key} = $${key}`)
      params[`$${key}`] = v
    }
  }
  for (const key of ANCHOR_JSON_KEYS) {
    const v = patch[key]
    if (v !== undefined) {
      sets.push(`${key} = $${key}`)
      params[`$${key}`] = v
    }
  }
  if ('locked_by_volume' in patch) {
    sets.push(`locked_by_volume = $locked_by_volume`)
    params.$locked_by_volume = patch.locked_by_volume ?? null
  }

  if (sets.length === 0) return 0
  return db.query(`UPDATE outline_anchors SET ${sets.join(', ')} WHERE novel_id = $novel_id`).run(
    params,
  ).changes
}

export const deleteAnchor = (novelId: number): number => stmtDeleteAnchor.run(novelId).changes

/* ==================== 卷大纲 ==================== */

export const insertOutlineVolume = (row: NewOutlineVolumeRow): number =>
  Number(
    stmtInsertOutlineVolume.run({
      $novel_id: row.novel_id,
      $volume_id: row.volume_id,
      $structure_type: row.structure_type,
      $acts: row.acts,
      $turning_points: row.turning_points,
      $pacing: row.pacing,
      $constraints: row.constraints,
      $anchor_snapshot: row.anchor_snapshot,
    }).lastInsertRowid,
  )

export const selectOutlineVolume = (volumeId: number): OutlineVolumeEntity | null =>
  stmtSelectOutlineVolume.get(volumeId) as OutlineVolumeEntity | null

export const selectOutlineVolumesByNovel = (novelId: number): OutlineVolumeEntity[] =>
  stmtSelectOutlineVolumesByNovel.all(novelId) as OutlineVolumeEntity[]

export const updateOutlineVolumeRow = (volumeId: number, patch: OutlineVolumeRowPatch): number => {
  const sets: string[] = []
  const params: Record<string, string | number> = { $volume_id: volumeId }

  for (const key of VOL_TEXT_KEYS) {
    const v = patch[key]
    if (v !== undefined) {
      sets.push(`${key} = $${key}`)
      params[`$${key}`] = v
    }
  }
  for (const key of VOL_JSON_KEYS) {
    const v = patch[key]
    if (v !== undefined) {
      sets.push(`${key} = $${key}`)
      params[`$${key}`] = v
    }
  }

  if (sets.length === 0) return 0
  return db
    .query(`UPDATE outline_volumes SET ${sets.join(', ')} WHERE volume_id = $volume_id`)
    .run(params).changes
}

export const deleteOutlineVolume = (volumeId: number): number =>
  stmtDeleteOutlineVolume.run(volumeId).changes

/**
 * 地点（locations）的数据库访问层。
 *
 * 这张表是自引用的：`parent_id → locations.id`。
 * 用处是「层级挂载」—— 世界观只铺粗骨架（青州），细粒度地点（旧观那口枯井）
 * 由剧情按需生长，但**必须挂得上去**，不能平铺成一堆同级的名字。
 *
 * 跟角色关系一样用「raw + 可空 id」：`parent_raw` 是世界观里写的名字，
 * `parent_id` 是查表解析的结果。解析不到就是 NULL —— 那说明父地点还没建，
 * 是一种待办状态，不是错误。
 */
import { db } from './createDB'
import type { LocationEntity } from '../../../db/types'

/* ==================== 入参类型 ==================== */

export type NewLocationRow = Omit<LocationEntity, 'id' | 'created_at' | 'updated_at'>
export type LocationRowPatch = Partial<Omit<LocationEntity, 'id' | 'novel_id' | 'created_at'>>

/* ==================== 字段白名单 ==================== */
const TEXT_KEYS = ['name', 'parent_raw', 'signature', 'role', 'updated_at'] as const
const JSON_KEYS = ['features'] as const

/* ==================== 预编译语句 ==================== */

const stmtInsert = db.query(`
  INSERT INTO locations (novel_id, name, parent_raw, parent_id, signature, features, role)
  VALUES ($novel_id, $name, $parent_raw, $parent_id, $signature, $features, $role)
`)
const stmtSelectById = db.query(`SELECT * FROM locations WHERE id = ?`)
const stmtSelectByName = db.query(`SELECT * FROM locations WHERE novel_id = ? AND name = ?`)
const stmtSelectByNovel = db.query(`SELECT * FROM locations WHERE novel_id = ? ORDER BY id`)
const stmtDelete = db.query(`DELETE FROM locations WHERE id = ?`)

/* ==================== 增 ==================== */

export const insertLocation = (row: NewLocationRow): number =>
  Number(
    stmtInsert.run({
      $novel_id: row.novel_id,
      $name: row.name,
      $parent_raw: row.parent_raw,
      $parent_id: row.parent_id,
      $signature: row.signature,
      $features: row.features,
      $role: row.role,
    }).lastInsertRowid,
  )

/* ==================== 查 ==================== */

export const selectLocation = (id: number): LocationEntity | null =>
  stmtSelectById.get(id) as LocationEntity | null

/** 按名字查 —— raw → id 解析用。精确相等 */
export const selectLocationByName = (novelId: number, name: string): LocationEntity | null =>
  stmtSelectByName.get(novelId, name) as LocationEntity | null

export const selectLocationsByNovel = (novelId: number): LocationEntity[] =>
  stmtSelectByNovel.all(novelId) as LocationEntity[]

/** 有 parent_raw 但没解析出 parent_id 的 —— 父地点还没建的那些 */
export const selectUnresolvedParents = (novelId: number): LocationEntity[] =>
  db
    .query(
      `SELECT * FROM locations
       WHERE novel_id = ? AND parent_id IS NULL AND parent_raw <> ''
       ORDER BY id`,
    )
    .all(novelId) as LocationEntity[]

/** 某个地点下的直接子地点。搭层级树用 */
export const selectChildren = (parentId: number): LocationEntity[] =>
  db.query(`SELECT * FROM locations WHERE parent_id = ? ORDER BY id`).all(parentId) as
    LocationEntity[]

/* ==================== 改 ==================== */

export const updateLocationRow = (id: number, patch: LocationRowPatch): number => {
  const sets: string[] = []
  const params: Record<string, string | number | null> = { $id: id }

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
  // parent_id 允许显式写 null（把一个地点提成根），所以判据是 key 在不在补丁里
  if ('parent_id' in patch) {
    sets.push(`parent_id = $parent_id`)
    params.$parent_id = patch.parent_id ?? null
  }

  if (sets.length === 0) return 0
  return db.query(`UPDATE locations SET ${sets.join(', ')} WHERE id = $id`).run(params).changes
}

/**
 * 把同一个名字下、还没解析的父子挂载关系补上。
 *
 * 场景：先建了「青州旧观的水井」（parent_raw = 青州），后来才建「青州」。
 * 建完青州之后回头补一遍。返回挂上了几个子地点。
 */
export const resolvePendingChildren = (
  novelId: number,
  parentName: string,
  parentId: number,
  now: string,
): number =>
  db
    .query(`
      UPDATE locations
      SET parent_id = $pid, updated_at = $now
      WHERE novel_id = $novel_id AND parent_id IS NULL AND parent_raw = $name
    `)
    .run({ $pid: parentId, $now: now, $novel_id: novelId, $name: parentName }).changes

/* ==================== 删 ==================== */

/** 返回受影响行数。子地点因为外键是 ON DELETE SET NULL，会变成根而不是跟着消失 */
export const deleteLocation = (id: number): number => stmtDelete.run(id).changes

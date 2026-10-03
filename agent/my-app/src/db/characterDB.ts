/**
 * 角色（characters + character_relations）的数据库访问层。
 *
 * 关系网是单独一张表，不是角色卡里的 JSON 数组。原因只有一个：
 * **外键能拦住现编的 id**。9-30 那次生成出的 `relations: ["protagonist",
 * "shen-wujiu-di"]` 里，前者是角色定位不是 id、后者那个人当时根本不存在 ——
 * 换成 JSON 列，这种错永远查不出来。
 *
 * 解析不到的关系留 `to_character_id = NULL`，那行就是"还没建的人"。
 */
import { db } from './createDB'
import type {
  CharacterEntity,
  CharacterRelationEntity,
  CharacterBriefVO,
  CharacterRole,
  CharacterStatus,
} from '../../../db/types'

/* ==================== 入参类型 ==================== */

export type NewCharacterRow = Omit<CharacterEntity, 'id' | 'created_at' | 'updated_at'>
export type CharacterRowPatch = Partial<Omit<CharacterEntity, 'id' | 'novel_id' | 'created_at'>>

export type NewRelationRow = Omit<CharacterRelationEntity, 'id' | 'created_at' | 'updated_at'>

/* ==================== 字段白名单 ==================== */
// 字段名要拼进 SQL，只能从这几个白名单取 —— 不能直接用传入对象的 key。
const TEXT_KEYS = [
  'name',
  'role',
  'voice',
  'want',
  'cost',
  'need',
  'secret',
  'reveal',
  'line',
  'flaw',
  'arc_start',
  'arc_end',
  'status',
  'source',
  'updated_at',
] as const
const JSON_KEYS = ['immutable'] as const

/* ==================== 预编译语句 ==================== */

const stmtInsert = db.query(`
  INSERT INTO characters
    (novel_id, name, role, immutable, voice, want, cost, need, secret, reveal,
     line, flaw, arc_start, arc_end, status, source)
  VALUES
    ($novel_id, $name, $role, $immutable, $voice, $want, $cost, $need, $secret, $reveal,
     $line, $flaw, $arc_start, $arc_end, $status, $source)
`)
const stmtSelectById = db.query(`SELECT * FROM characters WHERE id = ?`)
const stmtSelectByName = db.query(`SELECT * FROM characters WHERE novel_id = ? AND name = ?`)
const stmtSelectByNovel = db.query(`SELECT * FROM characters WHERE novel_id = ? ORDER BY id`)
const stmtDelete = db.query(`DELETE FROM characters WHERE id = ?`)

const stmtInsertRelation = db.query(`
  INSERT INTO character_relations (novel_id, from_character_id, to_raw, to_character_id, attitude, resolved_at)
  VALUES ($novel_id, $from_character_id, $to_raw, $to_character_id, $attitude, $resolved_at)
`)
const stmtRelationsByFrom = db.query(
  `SELECT * FROM character_relations WHERE from_character_id = ? ORDER BY id`,
)
const stmtRelationsByNovel = db.query(
  `SELECT * FROM character_relations WHERE novel_id = ? ORDER BY from_character_id, id`,
)
const stmtDeleteRelationsByFrom = db.query(
  `DELETE FROM character_relations WHERE from_character_id = ?`,
)

/* ==================== 增 ==================== */

export const insertCharacter = (row: NewCharacterRow): number =>
  Number(
    stmtInsert.run({
      $novel_id: row.novel_id,
      $name: row.name,
      $role: row.role,
      $immutable: row.immutable,
      $voice: row.voice,
      $want: row.want,
      $cost: row.cost,
      $need: row.need,
      $secret: row.secret,
      $reveal: row.reveal,
      $line: row.line,
      $flaw: row.flaw,
      $arc_start: row.arc_start,
      $arc_end: row.arc_end,
      $status: row.status,
      $source: row.source,
    }).lastInsertRowid,
  )

export const insertRelation = (row: NewRelationRow): number =>
  Number(
    stmtInsertRelation.run({
      $novel_id: row.novel_id,
      $from_character_id: row.from_character_id,
      $to_raw: row.to_raw,
      $to_character_id: row.to_character_id,
      $attitude: row.attitude,
      $resolved_at: row.resolved_at,
    }).lastInsertRowid,
  )

/* ==================== 查 ==================== */

export const selectCharacter = (id: number): CharacterEntity | null =>
  stmtSelectById.get(id) as CharacterEntity | null

/** 按名字查 —— raw → id 解析就靠它。精确相等，不做模糊匹配 */
export const selectCharacterByName = (novelId: number, name: string): CharacterEntity | null =>
  stmtSelectByName.get(novelId, name) as CharacterEntity | null

export const selectCharactersByNovel = (novelId: number): CharacterEntity[] =>
  stmtSelectByNovel.all(novelId) as CharacterEntity[]

export const selectRelationsByFrom = (characterId: number): CharacterRelationEntity[] =>
  stmtRelationsByFrom.all(characterId) as CharacterRelationEntity[]

export const selectRelationsByNovel = (novelId: number): CharacterRelationEntity[] =>
  stmtRelationsByNovel.all(novelId) as CharacterRelationEntity[]

/**
 * 精简列表 + 每张卡还有几条关系没兑现。
 *
 * 那个子查询就是"这张卡接完了没有"的答案。角色筛选走绑定参数，
 * 列名是代码字面量，没有注入口子。
 */
export const selectCharacterBriefs = (
  novelId: number,
  filter: { role?: CharacterRole; status?: CharacterStatus } = {},
): CharacterBriefVO[] => {
  const conds = ['c.novel_id = $novel_id']
  const params: Record<string, string | number> = { $novel_id: novelId }
  if (filter.role) {
    conds.push('c.role = $role')
    params.$role = filter.role
  }
  if (filter.status) {
    conds.push('c.status = $status')
    params.$status = filter.status
  }
  return db
    .query(`
      SELECT c.id, c.novel_id, c.name, c.role, c.status, c.source,
             (SELECT count(*) FROM character_relations r
              WHERE r.from_character_id = c.id AND r.to_character_id IS NULL) AS unresolvedRelations
      FROM characters c
      WHERE ${conds.join(' AND ')}
      ORDER BY c.id
    `)
    .all(params) as CharacterBriefVO[]
}

/** 关系网里指向了不存在角色的那些条 —— 待建清单的一半（另一半在 chapter_cast） */
export const selectUnresolvedRelations = (novelId: number): CharacterRelationEntity[] =>
  db
    .query(
      `SELECT * FROM character_relations
       WHERE novel_id = ? AND to_character_id IS NULL
       ORDER BY from_character_id, id`,
    )
    .all(novelId) as CharacterRelationEntity[]

/* ==================== 改 ==================== */

export const updateCharacterRow = (id: number, patch: CharacterRowPatch): number => {
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

  if (sets.length === 0) return 0
  return db.query(`UPDATE characters SET ${sets.join(', ')} WHERE id = $id`).run(params).changes
}

/**
 * 把一条关系解析到具体角色。
 *
 * 为什么要这一步：建卡时那个角色可能还不存在（大纲先写了 NEW: 需求）。
 * 等它建好之后，回头把同一本小说里所有指向这个名字的未解析关系补上。
 * 返回补了几条。
 */
export const resolvePendingRelations = (
  novelId: number,
  toRaw: string,
  characterId: number,
  now: string,
): number =>
  db
    .query(`
      UPDATE character_relations
      SET to_character_id = $cid, resolved_at = $now, updated_at = $now
      WHERE novel_id = $novel_id AND to_character_id IS NULL AND to_raw = $raw
    `)
    .run({ $cid: characterId, $now: now, $novel_id: novelId, $raw: toRaw }).changes

/* ==================== 删 ==================== */

export const deleteCharacter = (id: number): number => stmtDelete.run(id).changes

/** 重建一张卡的关系网：先清空再插。改 relations 时用 */
export const deleteRelationsByFrom = (characterId: number): number =>
  stmtDeleteRelationsByFrom.run(characterId).changes

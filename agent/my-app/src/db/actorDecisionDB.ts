/**
 * 角色裁决（actor_decisions）的数据库访问层。
 *
 * 存它换来的两样东西：
 *   1. writer 的 {DECISIONS} 有地方读
 *   2. **重跑同一章时不必重问 Actor** —— prompt_hash 一致就直接复用旧裁决。
 *      Actor 是每章可能问两三次的调用，这一步省下的是真金白银。
 *
 * 注意 character_id 可为 NULL：裁决时那个角色可能还没建卡（大纲先写了 NEW: 需求）。
 * 所以查重不能只靠 UNIQUE 约束 —— SQLite 里 NULL 互不相等，
 * 带 NULL 的行不会被 UNIQUE(chapter_id, character_id, prompt_hash) 判成冲突。
 * 要在 SQL 里显式写 `character_id IS NULL` 分支。
 */
import { db } from './createDB'
import type { ActorDecisionEntity } from '../../../db/types'

/* ==================== 入参类型 ==================== */

export type NewDecisionRow = Omit<ActorDecisionEntity, 'id' | 'created_at'>

/* ==================== 预编译语句 ==================== */

const stmtInsert = db.query(`
  INSERT INTO actor_decisions
    (novel_id, chapter_id, character_id, situation, options, choice,
     custom_answer, reason, line, prompt_hash)
  VALUES
    ($novel_id, $chapter_id, $character_id, $situation, $options, $choice,
     $custom_answer, $reason, $line, $prompt_hash)
`)
const stmtSelectById = db.query(`SELECT * FROM actor_decisions WHERE id = ?`)
const stmtByChapter = db.query(
  `SELECT * FROM actor_decisions WHERE chapter_id = ? ORDER BY id`,
)
const stmtDeleteByChapter = db.query(`DELETE FROM actor_decisions WHERE chapter_id = ?`)

/* ==================== 增 ==================== */

export const insertDecision = (row: NewDecisionRow): number =>
  Number(
    stmtInsert.run({
      $novel_id: row.novel_id,
      $chapter_id: row.chapter_id,
      $character_id: row.character_id,
      $situation: row.situation,
      $options: row.options,
      $choice: row.choice,
      $custom_answer: row.custom_answer,
      $reason: row.reason,
      $line: row.line,
      $prompt_hash: row.prompt_hash,
    }).lastInsertRowid,
  )

/* ==================== 查 ==================== */

export const selectDecisionById = (id: number): ActorDecisionEntity | null =>
  stmtSelectById.get(id) as ActorDecisionEntity | null

export const selectDecisionsByChapter = (chapterId: number): ActorDecisionEntity[] =>
  stmtByChapter.all(chapterId) as ActorDecisionEntity[]

/**
 * 按指纹找一条已有的裁决，用来判断"这一问是不是已经问过了"。
 *
 * characterId 传 null 时走 `IS NULL` 分支 —— 见文件头那段说明，
 * 这里不能写成 `= NULL`，那永远不成立。
 */
export const selectDecisionByHash = (
  chapterId: number,
  characterId: number | null,
  promptHash: string,
): ActorDecisionEntity | null => {
  const sql =
    characterId === null
      ? `SELECT * FROM actor_decisions
         WHERE chapter_id = ? AND character_id IS NULL AND prompt_hash = ? LIMIT 1`
      : `SELECT * FROM actor_decisions
         WHERE chapter_id = ? AND character_id = ? AND prompt_hash = ? LIMIT 1`
  const args = characterId === null ? [chapterId, promptHash] : [chapterId, characterId, promptHash]
  return db.query(sql).get(...args) as ActorDecisionEntity | null
}

/* ==================== 删 ==================== */

export const deleteDecisionsByChapter = (chapterId: number): number =>
  stmtDeleteByChapter.run(chapterId).changes

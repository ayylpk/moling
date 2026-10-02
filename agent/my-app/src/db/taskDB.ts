/**
 * 生成任务（generation_tasks 表）的数据库访问层。
 *
 * 这张表是「分阶段产出 + 断点续跑」的骨架：
 * 每次开工前先按 (novel_id, stage, target_key) 查一眼，就知道该跳过还是该重跑。
 *
 * 这一层只做 SQL，不判断"该不该跑" —— 那是 taskService 的事。
 */
import { db } from './createDB'
import { STAGE_ORDER } from '../../../db/types'
import type { GenerationTaskEntity, Stage, TaskStatus } from '../../../db/types'

/* ==================== 入参类型 ==================== */

export type NewTaskRow = Pick<GenerationTaskEntity, 'novel_id' | 'stage' | 'target_key'> &
  Partial<Pick<GenerationTaskEntity, 'status' | 'input_hash' | 'artifact_path'>>

export type TaskRowPatch = Partial<
  Omit<GenerationTaskEntity, 'id' | 'novel_id' | 'stage' | 'target_key' | 'created_at'>
>

/* ==================== 字段白名单 ==================== */
const TEXT_KEYS = ['status', 'input_hash', 'artifact_path', 'error', 'updated_at'] as const
const NUM_KEYS = ['attempt'] as const
const NULLABLE_TEXT_KEYS = ['started_at', 'finished_at'] as const

/**
 * 阶段排序表达式。
 *
 * 让「按阶段顺序列出待办」在 SQL 层完成 —— 否则要把整表拉回内存再排。
 * STAGE_ORDER 是代码里的常量表，不是用户输入，拼进 SQL 是安全的。
 * 加了新阶段只要改 entity.ts 那一处，这里跟着变。
 */
const STAGE_RANK = `CASE stage ${STAGE_ORDER.map((s, i) => `WHEN '${s}' THEN ${i}`).join(' ')} ELSE 99 END`

/* ==================== 预编译语句 ==================== */

const stmtInsert = db.query(`
  INSERT INTO generation_tasks (novel_id, stage, target_key, status, input_hash, artifact_path)
  VALUES ($novel_id, $stage, $target_key, $status, $input_hash, $artifact_path)
`)
const stmtSelectOne = db.query(`
  SELECT * FROM generation_tasks WHERE novel_id = ? AND stage = ? AND target_key = ?
`)
const stmtSelectById = db.query(`SELECT * FROM generation_tasks WHERE id = ?`)
const stmtSelectByNovel = db.query(`
  SELECT * FROM generation_tasks WHERE novel_id = ? ORDER BY ${STAGE_RANK}, id
`)
const stmtSelectRemaining = db.query(`
  SELECT * FROM generation_tasks WHERE novel_id = ? AND status != 'done'
  ORDER BY ${STAGE_RANK}, id
`)
const stmtGroupCount = db.query(`
  SELECT stage, status, count(*) AS c FROM generation_tasks
  WHERE novel_id = ? GROUP BY stage, status
`)
const stmtMarkRunningStale = db.query(`
  UPDATE generation_tasks SET status = 'stale', updated_at = $now
  WHERE novel_id = $novel_id AND status = 'running'
`)
const stmtDeleteByNovel = db.query(`DELETE FROM generation_tasks WHERE novel_id = ?`)

/* ==================== 增 ==================== */

/** 插入一个待办任务，返回新的 id。同一 (novel, stage, target_key) 重复插入会撞 UNIQUE 约束 */
export const insertTask = (row: NewTaskRow): number => {
  const info = stmtInsert.run({
    $novel_id: row.novel_id,
    $stage: row.stage,
    $target_key: row.target_key,
    $status: row.status ?? 'pending',
    $input_hash: row.input_hash ?? '',
    $artifact_path: row.artifact_path ?? '',
  })
  return Number(info.lastInsertRowid)
}

/* ==================== 查 ==================== */

export const selectTask = (
  novelId: number,
  stage: Stage,
  targetKey: string,
): GenerationTaskEntity | null =>
  stmtSelectOne.get(novelId, stage, targetKey) as GenerationTaskEntity | null

export const selectTaskById = (id: number): GenerationTaskEntity | null =>
  stmtSelectById.get(id) as GenerationTaskEntity | null

export const selectTasksByNovel = (novelId: number): GenerationTaskEntity[] =>
  stmtSelectByNovel.all(novelId) as GenerationTaskEntity[]

/** 所有还没 done 的任务（含 failed / stale / running），按阶段顺序排 */
export const selectRemainingTasks = (novelId: number): GenerationTaskEntity[] =>
  stmtSelectRemaining.all(novelId) as GenerationTaskEntity[]

/** 按 (阶段, 状态) 分组的计数，进度接口用 */
export const selectStageStatusCounts = (
  novelId: number,
): { stage: Stage; status: TaskStatus; c: number }[] =>
  stmtGroupCount.all(novelId) as { stage: Stage; status: TaskStatus; c: number }[]

/**
 * 带筛选的列表。两个条件都可选，都走绑定参数。
 *
 * 没有用预编译语句：阶段与状态是 6×5 种组合，为每种组合 prepare 一条不划算。
 * 这里动态拼的只有"要不要加这个条件"，列名是代码里的字面量，值一律绑定 —— 没有注入口子。
 */
export const selectTasksFiltered = (
  novelId: number,
  filter: { stage?: Stage; status?: TaskStatus },
): GenerationTaskEntity[] => {
  const conds = ['novel_id = $novel_id']
  const params: Record<string, string | number> = { $novel_id: novelId }
  if (filter.stage) {
    conds.push('stage = $stage')
    params.$stage = filter.stage
  }
  if (filter.status) {
    conds.push('status = $status')
    params.$status = filter.status
  }
  return db
    .query(`SELECT * FROM generation_tasks WHERE ${conds.join(' AND ')} ORDER BY ${STAGE_RANK}, id`)
    .all(params) as GenerationTaskEntity[]
}

/* ==================== 改 ==================== */

/** 只更新补丁里出现的字段，返回受影响行数 */
export const updateTaskRow = (id: number, patch: TaskRowPatch): number => {
  const sets: string[] = []
  const params: Record<string, string | number | null> = { $id: id }

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
  // 这两个允许显式写 null（清空开始/结束时间），所以判据是 key 在不在补丁里，
  // 不是值是不是 undefined。
  for (const key of NULLABLE_TEXT_KEYS) {
    if (key in patch) {
      sets.push(`${key} = $${key}`)
      params[`$${key}`] = patch[key] ?? null
    }
  }

  if (sets.length === 0) return 0
  return db.query(`UPDATE generation_tasks SET ${sets.join(', ')} WHERE id = $id`).run(params)
    .changes
}

/**
 * 把该小说下所有 running 的任务标成 stale。
 *
 * 用途：上次跑到一半被 Ctrl-C 掉了，库里会留下永远 running 的行。
 * 下次开工前先跑一遍这个，那些行就变成"需要重做"，不会一直卡在那儿。
 */
export const markRunningAsStale = (novelId: number, now: string): number =>
  stmtMarkRunningStale.run({ $novel_id: novelId, $now: now }).changes

/**
 * 失效传播：把指定阶段（及调用方算好的下游阶段）里已 done 的任务标成 stale。
 *
 * 为什么不在这里算"下游"：阶段顺序的知识在 entity.ts，但"上游一变作废多少下游"
 * 是业务判断，放 service。这一层只负责按给定的阶段集合更新。
 */
export const invalidateStages = (novelId: number, stages: Stage[], now: string): number => {
  if (stages.length === 0) return 0
  const placeholders = stages.map(() => '?').join(', ')
  return db
    .query(`
      UPDATE generation_tasks SET status = 'stale', updated_at = ?
      WHERE novel_id = ? AND status = 'done' AND stage IN (${placeholders})
    `)
    .run(now, novelId, ...stages).changes
}

/* ==================== 删 ==================== */

/** 清掉一本小说的全部任务记录。删小说时外键会级联删，这个用于"重来一遍" */
export const deleteTasksByNovel = (novelId: number): number =>
  stmtDeleteByNovel.run(novelId).changes

/**
 * 生成任务业务层 —— 断点续跑的核心判断都在这里。
 *
 * 一句话说明它解决的问题：小说是分阶段产出的，一次跑不完。
 * 所以每次开工前先问一句「这一步是不是已经跑过了、而且输入没变」，
 * 是就跳过（复用磁盘产物），不是就跑。
 *
 * 判断只靠两样东西：status 和 input_hash。
 */
import * as store from '../db/taskDB'
import * as novelStore from '../db/novelDB'
import { withTransaction } from '../db/createDB'
import { now } from '../shared/time'
import { STAGE_ORDER, TASK_STATUS } from '../../../db/types'
import type {
  ClaimTaskDTO,
  ClaimTaskVO,
  FailTaskDTO,
  FinishTaskDTO,
  GenerationProgressVO,
  GenerationTaskVO,
  PlanTasksDTO,
  Stage,
  StageProgressVO,
  TaskQueryDTO,
  TaskStatus,
} from '../../../db/types'

/* ==================== 校验 ==================== */

const assertStage = (stage: unknown): Stage => {
  if (!(STAGE_ORDER as readonly string[]).includes(stage as string)) {
    throw new TypeError(`stage 只能是 ${STAGE_ORDER.join(' / ')}`)
  }
  return stage as Stage
}

/** 任务表挂在 novels 上，小说不存在就别往下走了 —— 外键报错比这句话难懂 */
const assertNovelExists = (novelId: number): void => {
  if (!Number.isInteger(novelId) || novelId <= 0) throw new TypeError('novelId 必须是正整数')
  if (!novelStore.selectNovel(novelId)) throw new TypeError(`novelId=${novelId} 不存在`)
}

const assertTargetKey = (key: unknown): string => {
  if (typeof key !== 'string' || !key.trim()) throw new TypeError('target_key 不能为空')
  return key.trim()
}

/* ==================== 登记待办 ==================== */

/**
 * 批量登记待办。**已存在的任务一律不动** —— 只补没有的。
 *
 * 这样重复登记是安全的：跑第二遍不会把已经 done 的任务打回 pending。
 */
export const planTasks = (
  novelId: number,
  dto: PlanTasksDTO,
): { created: number; skipped: number; tasks: GenerationTaskVO[] } => {
  assertNovelExists(novelId)
  const stage = assertStage(dto.stage)
  if (!Array.isArray(dto.target_keys)) throw new TypeError('target_keys 必须是数组')

  const keys = dto.target_keys.map(assertTargetKey)
  if (keys.length === 0) throw new TypeError('target_keys 不能为空数组')

  let created = 0
  let skipped = 0
  withTransaction(() => {
    for (const key of keys) {
      if (store.selectTask(novelId, stage, key)) {
        skipped++
        continue
      }
      store.insertTask({
        novel_id: novelId,
        stage,
        target_key: key,
        status: 'pending',
        input_hash: dto.input_hash ?? '',
      })
      created++
    }
  })

  return { created, skipped, tasks: store.selectTasksFiltered(novelId, { stage }) }
}

/* ==================== 领任务（续跑判断点） ==================== */

/**
 * 领一个任务，返回该跑还是该跳。
 *
 * 规则：
 *   没有记录                              → run（首次）
 *   done 且 本次带了指纹 且 指纹与上次一致  → skip（复用磁盘产物）
 *   其余一切情况                          → run（并把 attempt +1）
 *
 * 为什么"本次没带指纹"要算 run：空指纹表示调用方放弃了缓存判断，
 * 那就一律重跑。宁可多花一次调用，也不要拿旧输入的结果往下写。
 */
export const claimTask = (novelId: number, dto: ClaimTaskDTO): ClaimTaskVO => {
  assertNovelExists(novelId)
  const stage = assertStage(dto.stage)
  const targetKey = assertTargetKey(dto.target_key)
  const hash = (dto.input_hash ?? '').trim()
  const ts = now()

  // 包事务：跟着的 insert / update 和这次读必须是一个原子动作。
  // 现在是单进程单连接（bun:sqlite 是同步的），理论上一句就够了；
  // 但"查了再写"这种模式一旦将来并行就会互相踩，现在锁住不留隐患。
  return withTransaction(() => {
    const existing = store.selectTask(novelId, stage, targetKey)

    if (!existing) {
      const id = store.insertTask({
        novel_id: novelId,
        stage,
        target_key: targetKey,
        status: 'running',
        input_hash: hash,
      })
      store.updateTaskRow(id, { attempt: 1, started_at: ts, updated_at: ts })
      return { action: 'run', reason: '首次执行', task: store.selectTaskById(id)! }
    }

    if (existing.status === 'done' && hash && existing.input_hash === hash) {
      return { action: 'skip', reason: '输入未变，复用磁盘产物', task: existing }
    }

    // 分三种情况说清楚，别把"登记了还没跑"和"跑完过但输入变了"混成一句 ——
    // 前者是正常流程，后者意味着下游有产物要作废，处理方式完全不同。
    const reason =
      existing.attempt === 0
        ? '尚未执行'
        : existing.status === 'done'
          ? '输入已变，需要重跑'
          : `上次结束状态是 ${existing.status}，需要重跑`

    store.updateTaskRow(existing.id, {
      status: 'running',
      attempt: existing.attempt + 1,
      input_hash: hash,
      error: '',
      started_at: ts,
      finished_at: null,
      updated_at: ts,
    })
    return { action: 'run', reason, task: store.selectTaskById(existing.id)! }
  })
}

/* ==================== 收尾 ==================== */

const pickTask = (novelId: number, taskId: number): GenerationTaskVO => {
  const t = store.selectTaskById(taskId)
  if (!t || t.novel_id !== novelId) throw new TypeError(`taskId=${taskId} 不属于 novelId=${novelId}`)
  return t
}

/** 标完成。artifact_path 传了就更新，不传保留原值 */
export const finishTask = (
  novelId: number,
  taskId: number,
  dto: FinishTaskDTO,
): GenerationTaskVO => {
  const t = pickTask(novelId, taskId)
  const ts = now()
  store.updateTaskRow(taskId, {
    status: 'done',
    artifact_path: dto.artifact_path ?? t.artifact_path,
    error: '',
    finished_at: ts,
    updated_at: ts,
  })
  return store.selectTaskById(taskId)!
}

/** 标失败。error 原样留下 —— 下次 claim 时它就是"上次为什么没成"的答案 */
export const failTask = (novelId: number, taskId: number, dto: FailTaskDTO): GenerationTaskVO => {
  pickTask(novelId, taskId)
  const ts = now()
  store.updateTaskRow(taskId, {
    status: 'failed',
    error: String(dto.error ?? '').slice(0, 2000),
    finished_at: ts,
    updated_at: ts,
  })
  return store.selectTaskById(taskId)!
}

/**
 * 把上次中断（还挂着 running）的任务标成 stale。
 *
 * 场景：跑到一半 Ctrl-C 掉了。库里会留下永远 running 的行，
 * 不清理的话它们既不算完成也不在待办里，进度看着正常但实际上卡住了。
 * 开工前先跑一次这个。
 */
export const resetStaleRunning = (novelId: number): { changed: number } => {
  assertNovelExists(novelId)
  return { changed: store.markRunningAsStale(novelId, now()) }
}

/* ==================== 失效传播 ==================== */

/**
 * 上游一变，下游全部作废。
 *
 * **不含 from_stage 自己**，只作废它下游的。原因：
 * 自己的记录是"这一版已经生成过"的历史事实。
 * 世界观改了应当是新建一版（target_key = "v2"），v1 那条记录不该被抹掉 ——
 * 它对"这一卷是基于哪版生成的"这个问题是有用的答案。
 *
 *      invalidateFromStage(id, 'world')   → character / location / outline / chapter / polish
 *      invalidateFromStage(id, 'outline') → chapter / polish
 */
export const invalidateFromStage = (
  novelId: number,
  fromStage: Stage,
): { from_stage: Stage; invalidated_stages: Stage[]; changed: number } => {
  assertNovelExists(novelId)
  const stage = assertStage(fromStage)
  const idx = (STAGE_ORDER as readonly string[]).indexOf(stage)
  const downstream = STAGE_ORDER.slice(idx + 1) as unknown as Stage[]
  return {
    from_stage: stage,
    invalidated_stages: downstream,
    changed: store.invalidateStages(novelId, downstream, now()),
  }
}

/* ==================== 查询 ==================== */

export const listTasks = (novelId: number, query: TaskQueryDTO = {}): GenerationTaskVO[] => {
  assertNovelExists(novelId)
  const filter: { stage?: Stage; status?: TaskStatus } = {}
  if (query.stage !== undefined) filter.stage = assertStage(query.stage)
  if (query.status !== undefined) {
    if (!(TASK_STATUS as readonly string[]).includes(query.status)) {
      throw new TypeError(`status 只能是 ${TASK_STATUS.join(' / ')}`)
    }
    filter.status = query.status as TaskStatus
  }
  return store.selectTasksFiltered(novelId, filter)
}

/**
 * 进度快照。byStage 会把所有阶段都列出来（没任务的补 0），
 * 这样调用方不用自己对齐阶段顺序 —— 直接照着渲染就行。
 */
export const getProgress = (novelId: number): GenerationProgressVO => {
  assertNovelExists(novelId)
  const counts = store.selectStageStatusCounts(novelId)

  const byStage: StageProgressVO[] = (STAGE_ORDER as readonly Stage[]).map((stage) => {
    const rows = counts.filter((r) => r.stage === stage)
    const sum = (s: TaskStatus) => rows.filter((r) => r.status === s).reduce((a, r) => a + r.c, 0)
    return {
      stage,
      total: rows.reduce((a, r) => a + r.c, 0),
      done: sum('done'),
      failed: sum('failed'),
      stale: sum('stale'),
      running: sum('running'),
      pending: sum('pending'),
    }
  })

  return {
    novel_id: novelId,
    total: byStage.reduce((a, s) => a + s.total, 0),
    done: byStage.reduce((a, s) => a + s.done, 0),
    byStage,
    remaining: store.selectRemainingTasks(novelId).map((t) => ({
      stage: t.stage,
      target_key: t.target_key,
      status: t.status,
    })),
  }
}

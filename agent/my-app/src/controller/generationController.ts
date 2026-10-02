/**
 * 生成进度与续跑的 HTTP 接口。
 *
 * 挂载点（src/index.ts）：
 *   app.route('/api/novels/:novelId/generation', generationController)
 *
 * 这一组接口就是「分阶段产出」的对外形状。典型用法：
 *
 *   1. POST /plan          —— 把这一批要跑的对象登记成待办
 *   2. POST /claim         —— 逐个领；返回 skip 的直接跳过，返回 run 的才去调 agent
 *   3. POST /tasks/:id/finish 或 /fail —— 收尾，finish 时把磁盘产物路径记上
 *   4. GET  /             —— 随时看进度快照和 remaining
 *
 * claim 是整套东西的关键：它拿 input_hash 和上次比，一致才给 skip。
 * 所以调用方**必须**把这次的真实输入算成 hash 传进来，否则一律重跑。
 */
import { Hono } from 'hono'
import * as service from '../service/taskService'
import { parseId, fail, readJson } from '../shared/http'
import type {
  ClaimTaskDTO,
  FailTaskDTO,
  FinishTaskDTO,
  InvalidateDTO,
  PlanTasksDTO,
  Stage,
  TaskStatus,
} from '../../../db/types'

export const generationController = new Hono()

/** 每一条路由都要先拿 novelId */
const novelIdOf = (c: { req: { param: (k: string) => string | undefined } }): number | null =>
  parseId(c.req.param('novelId'))

/* ==================== 进度 ==================== */

/** GET /api/novels/:novelId/generation —— 进度快照 + remaining */
generationController.get('/', (c) => {
  const novelId = novelIdOf(c)
  if (novelId === null) return c.json({ message: 'novelId 必须是整数' }, 400)
  try {
    return c.json(service.getProgress(novelId))
  } catch (e) {
    return fail(c, e)
  }
})

/** GET /api/novels/:novelId/generation/tasks?stage=chapter&status=failed */
generationController.get('/tasks', (c) => {
  const novelId = novelIdOf(c)
  if (novelId === null) return c.json({ message: 'novelId 必须是整数' }, 400)

  const stage = c.req.query('stage')
  const status = c.req.query('status')
  try {
    return c.json(
      service.listTasks(novelId, {
        stage: stage === undefined ? undefined : (stage as Stage),
        status: status === undefined ? undefined : (status as TaskStatus),
      }),
    )
  } catch (e) {
    return fail(c, e)
  }
})

/* ==================== 登记与领取 ==================== */

/** POST /api/novels/:novelId/generation/plan —— body 是 PlanTasksDTO */
generationController.post('/plan', async (c) => {
  const novelId = novelIdOf(c)
  if (novelId === null) return c.json({ message: 'novelId 必须是整数' }, 400)

  const body = await readJson<PlanTasksDTO>(c)
  if (body === undefined) return c.json({ message: '请求体不是合法 JSON' }, 400)

  try {
    return c.json(service.planTasks(novelId, body))
  } catch (e) {
    return fail(c, e)
  }
})

/** POST /api/novels/:novelId/generation/claim —— body 是 ClaimTaskDTO，返回 { action, reason, task } */
generationController.post('/claim', async (c) => {
  const novelId = novelIdOf(c)
  if (novelId === null) return c.json({ message: 'novelId 必须是整数' }, 400)

  const body = await readJson<ClaimTaskDTO>(c)
  if (body === undefined) return c.json({ message: '请求体不是合法 JSON' }, 400)

  try {
    return c.json(service.claimTask(novelId, body))
  } catch (e) {
    return fail(c, e)
  }
})

/** POST /api/novels/:novelId/generation/reset-stale —— 清掉上次中断留下的 running */
generationController.post('/reset-stale', (c) => {
  const novelId = novelIdOf(c)
  if (novelId === null) return c.json({ message: 'novelId 必须是整数' }, 400)
  try {
    return c.json(service.resetStaleRunning(novelId))
  } catch (e) {
    return fail(c, e)
  }
})

/** POST /api/novels/:novelId/generation/invalidate —— body 是 { from_stage } */
generationController.post('/invalidate', async (c) => {
  const novelId = novelIdOf(c)
  if (novelId === null) return c.json({ message: 'novelId 必须是整数' }, 400)

  const body = await readJson<InvalidateDTO>(c)
  if (body === undefined) return c.json({ message: '请求体不是合法 JSON' }, 400)

  try {
    return c.json(service.invalidateFromStage(novelId, body.from_stage))
  } catch (e) {
    return fail(c, e)
  }
})

/* ==================== 收尾 ==================== */
// 两条路径都是 /tasks/:taskId/xxx，段数比 '/tasks' 多，不会跟它抢。

/** POST /api/novels/:novelId/generation/tasks/:taskId/finish */
generationController.post('/tasks/:taskId/finish', async (c) => {
  const novelId = novelIdOf(c)
  if (novelId === null) return c.json({ message: 'novelId 必须是整数' }, 400)
  const taskId = parseId(c.req.param('taskId'))
  if (taskId === null) return c.json({ message: 'taskId 必须是整数' }, 400)

  // finish 允许空 body：只标完成、不动 artifact_path 也是合法用法
  const body = (await readJson<FinishTaskDTO>(c)) ?? {}
  try {
    return c.json(service.finishTask(novelId, taskId, body))
  } catch (e) {
    return fail(c, e)
  }
})

/** POST /api/novels/:novelId/generation/tasks/:taskId/fail —— body 是 { error } */
generationController.post('/tasks/:taskId/fail', async (c) => {
  const novelId = novelIdOf(c)
  if (novelId === null) return c.json({ message: 'novelId 必须是整数' }, 400)
  const taskId = parseId(c.req.param('taskId'))
  if (taskId === null) return c.json({ message: 'taskId 必须是整数' }, 400)

  const body = await readJson<FailTaskDTO>(c)
  if (body === undefined) return c.json({ message: '请求体不是合法 JSON' }, 400)

  try {
    return c.json(service.failTask(novelId, taskId, body))
  } catch (e) {
    return fail(c, e)
  }
})

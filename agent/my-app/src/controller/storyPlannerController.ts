/**
 * 世界观的 HTTP 接口（对外暴露的那一层）。
 *
 * 职责只有：解析请求 -> 调 service -> 拼响应。
 * 不写 SQL、不做业务判断、不碰 DTO/VO 的转换，那些都在 service。
 *
 * 挂载点在 src/index.ts：app.route('/api/worlds', storyPlannerController)
 */
import { Hono } from 'hono'
import type { Context } from 'hono'
import * as service from '../service/storyPlannerService'
import type { CreateWorldDTO, UpdateWorldDTO } from '../../../db/types'

export const storyPlannerController = new Hono()

/* ==================== 小工具 ==================== */

/** 把 URL 里的 :id 转成数字，不是整数就返回 null */
const parseId = (raw: string | undefined): number | null =>
  raw && /^\d+$/.test(raw) ? Number(raw) : null

/** service 抛的业务错误统一转 400，别把异常糊成 500 */
const fail = (c: Context, e: unknown) =>
  c.json({ message: e instanceof Error ? e.message : String(e) }, 400)

/** 读 JSON body，解析失败返回 undefined */
const readJson = async <T>(c: Context): Promise<T | undefined> => {
  try {
    return (await c.req.json()) as T
  } catch {
    return undefined
  }
}

/* ==================== 路由 ==================== */
// 顺序有讲究：/brief、/search 这种固定路径必须写在 /:id 前面，
// 否则 ':id' 会把 'brief' 也吃掉，当成 id=brief 处理。

/** GET /api/worlds?novelId=1 —— novelId 可省略，省略即全部 */
storyPlannerController.get('/', (c) => {
  const raw = c.req.query('novelId')
  if (raw !== undefined && parseId(raw) === null) {
    return c.json({ message: 'novelId 必须是整数' }, 400)
  }
  return c.json(service.listWorlds(raw === undefined ? undefined : Number(raw)))
})

/** GET /api/worlds/brief?novelId=1 —— 精简列表，只带规则条数 */
storyPlannerController.get('/brief', (c) => {
  const id = parseId(c.req.query('novelId'))
  if (id === null) return c.json({ message: 'novelId 必填且必须是整数' }, 400)
  return c.json(service.listWorldBriefs(id))
})

/** GET /api/worlds/search?kw=燃烧 —— 在规则文本里搜 */
storyPlannerController.get('/search', (c) => {
  const kw = c.req.query('kw')
  if (!kw) return c.json({ message: 'kw 必填' }, 400)
  try {
    return c.json(service.searchByRule(kw))
  } catch (e) {
    return fail(c, e)
  }
})

/** GET /api/worlds/:id */
storyPlannerController.get('/:id', (c) => {
  const id = parseId(c.req.param('id'))
  if (id === null) return c.json({ message: 'id 必须是整数' }, 400)

  const world = service.getWorld(id)
  if (!world) return c.json({ message: `id=${id} 不存在` }, 404)
  return c.json(world)
})

/** POST /api/worlds —— body 是 CreateWorldDTO */
storyPlannerController.post('/', async (c) => {
  const body = await readJson<CreateWorldDTO>(c)
  if (body === undefined) return c.json({ message: '请求体不是合法 JSON' }, 400)

  try {
    return c.json(service.createWorld(body), 201)
  } catch (e) {
    return fail(c, e)
  }
})

/** PATCH /api/worlds/:id —— 只传要改的字段 */
storyPlannerController.patch('/:id', async (c) => {
  const id = parseId(c.req.param('id'))
  if (id === null) return c.json({ message: 'id 必须是整数' }, 400)

  const body = await readJson<UpdateWorldDTO>(c)
  if (body === undefined) return c.json({ message: '请求体不是合法 JSON' }, 400)

  try {
    const world = service.updateWorld(id, body)
    if (!world) return c.json({ message: `id=${id} 不存在` }, 404)
    return c.json(world)
  } catch (e) {
    return fail(c, e)
  }
})

/** DELETE /api/worlds/:id */
storyPlannerController.delete('/:id', (c) => {
  const id = parseId(c.req.param('id'))
  if (id === null) return c.json({ message: 'id 必须是整数' }, 400)

  if (!service.deleteWorld(id)) return c.json({ message: `id=${id} 不存在` }, 404)
  return c.body(null, 204)
})

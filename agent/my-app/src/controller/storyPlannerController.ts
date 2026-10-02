/**
 * 世界观的 HTTP 接口（对外暴露的那一层）。
 *
 * 职责只有：解析请求 -> 调 service -> 拼响应。
 * 不写 SQL、不做业务判断、不碰 DTO/VO 的转换，那些都在 service。
 *
 * 挂载点在 src/index.ts：app.route('/api/worlds', storyPlannerController)
 *
 * 三个小工具（parseId / fail / readJson）已提到 shared/http.ts —— 现在有三个
 * controller 用同一套，留在各自文件里就是抄三遍。
 */
import { Hono } from 'hono'
import * as service from '../service/storyPlannerService'
import { parseId, fail, readJson } from '../shared/http'
import type { CreateWorldDTO, UpdateWorldDTO } from '../../../db/types'

export const storyPlannerController = new Hono()

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

/**
 * GET /api/worlds/current?novelId=1 —— 当前生效的那一版（版本号最大）。
 *
 * 下游（大纲/章节/正文）要世界观时应该走这个，而不是 /brief 的第一条 ——
 * 让"取当前版本"这个决定在服务端做一次，别让每个调用方各自排序。
 */
storyPlannerController.get('/current', (c) => {
  const id = parseId(c.req.query('novelId'))
  if (id === null) return c.json({ message: 'novelId 必填且必须是整数' }, 400)

  const world = service.getCurrentWorld(id)
  if (!world) return c.json({ message: `novelId=${id} 还没有世界观` }, 404)
  return c.json(world)
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

/**
 * POST /api/worlds —— body 是 CreateWorldDTO。
 *
 * 不传 version 时自动建下一版。想改世界观内容就再 POST 一版，
 * 别用 PATCH 原地改规则 —— 原地改的话下游那些基于旧版生成的产物
 * 就成了无主之物，之后没法判断该不该重跑。
 */
storyPlannerController.post('/', async (c) => {
  const body = await readJson<CreateWorldDTO>(c)
  if (body === undefined) return c.json({ message: '请求体不是合法 JSON' }, 400)

  try {
    return c.json(service.createWorld(body), 201)
  } catch (e) {
    return fail(c, e)
  }
})

/** PATCH /api/worlds/:id —— 只传要改的字段。留给改错别字这种原地修正 */
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

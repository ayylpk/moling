/**
 * 小说的 HTTP 接口。
 *
 * 挂载点（src/index.ts）：
 *   app.route('/api/novels', novelController)
 *   app.route('/api/novels/:novelId/generation', generationController)
 *
 * novels 是整库的根：其余所有内容表都挂在某本小说下面，
 * 所以这里的 id 是所有下游接口的第一个参数。
 */
import { Hono } from 'hono'
import * as service from '../service/novelService'
import { parseId, fail, readJson } from '../shared/http'
import { NOVEL_STATUS } from '../../../db/types'
import type { CreateNovelDTO, UpdateNovelDTO, NovelStatus } from '../../../db/types'

export const novelController = new Hono()

/* ==================== 路由 ==================== */
// 顺序有讲究：'/slug/:slug' 这种固定前缀必须写在 '/:id' 前面，
// 否则 ':id' 会把 'slug' 也吃掉，当成 id=slug 处理。

/** GET /api/novels?status=writing —— status 可省略，省略即全部 */
novelController.get('/', (c) => {
  const raw = c.req.query('status')
  if (raw !== undefined && !(NOVEL_STATUS as readonly string[]).includes(raw)) {
    return c.json({ message: `status 只能是 ${NOVEL_STATUS.join(' / ')}` }, 400)
  }
  try {
    return c.json(service.listNovels(raw === undefined ? undefined : (raw as NovelStatus)))
  } catch (e) {
    return fail(c, e)
  }
})

/** GET /api/novels/slug/linjiang —— 按 slug 取，磁盘目录名就是它 */
novelController.get('/slug/:slug', (c) => {
  const slug = c.req.param('slug')
  const novel = service.getNovelBySlug(slug)
  if (!novel) return c.json({ message: `slug=${slug} 不存在` }, 404)
  return c.json(novel)
})

/** GET /api/novels/:id */
novelController.get('/:id', (c) => {
  const id = parseId(c.req.param('id'))
  if (id === null) return c.json({ message: 'id 必须是整数' }, 400)

  const novel = service.getNovel(id)
  if (!novel) return c.json({ message: `id=${id} 不存在` }, 404)
  return c.json(novel)
})

/** POST /api/novels —— body 是 CreateNovelDTO */
novelController.post('/', async (c) => {
  const body = await readJson<CreateNovelDTO>(c)
  if (body === undefined) return c.json({ message: '请求体不是合法 JSON' }, 400)

  try {
    return c.json(service.createNovel(body), 201)
  } catch (e) {
    return fail(c, e)
  }
})

/** PATCH /api/novels/:id —— 只传要改的字段 */
novelController.patch('/:id', async (c) => {
  const id = parseId(c.req.param('id'))
  if (id === null) return c.json({ message: 'id 必须是整数' }, 400)

  const body = await readJson<UpdateNovelDTO>(c)
  if (body === undefined) return c.json({ message: '请求体不是合法 JSON' }, 400)

  try {
    const novel = service.updateNovel(id, body)
    if (!novel) return c.json({ message: `id=${id} 不存在` }, 404)
    return c.json(novel)
  } catch (e) {
    return fail(c, e)
  }
})

/**
 * DELETE /api/novels/:id
 *
 * 注意：会级联删掉这本小说下的世界观和生成任务（外键 ON DELETE CASCADE）。
 * 后面加了角色/大纲/章节/正文表，也都会跟着走。删之前想清楚。
 */
novelController.delete('/:id', (c) => {
  const id = parseId(c.req.param('id'))
  if (id === null) return c.json({ message: 'id 必须是整数' }, 400)

  if (!service.deleteNovel(id)) return c.json({ message: `id=${id} 不存在` }, 404)
  return c.body(null, 204)
})

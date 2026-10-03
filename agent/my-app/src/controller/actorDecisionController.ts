/**
 * 角色裁决接口。
 *
 * 挂载点：app.route('/api/novels/:novelId/decisions', actorDecisionController)
 *
 * 裁决是按章组织的，所以查询都带 `?chapterId=N`。
 *
 *   POST /            记一次裁决（同一 prompt_hash 只问一次，重复提交会复用旧记录）
 *   GET  /?chapterId= 这一章的裁决列表
 *   GET  /text?chapterId=  拼好给 writer 的 {DECISIONS} 段
 *   DELETE /?chapterId=    清掉这一章的裁决
 */
import { Hono } from 'hono'
import * as service from '../service/actorDecisionService'
import { parseId, novelIdOf, fail, readJson } from '../shared/http'
import type { SaveActorDecisionDTO } from '../../../db/types'

export const actorDecisionController = new Hono()

/** 取 ?chapterId=，必填 */
const chapterIdOf = (c: { req: { query: (k: string) => string | undefined } }): number | null =>
  parseId(c.req.query('chapterId'))

/**
 * GET /api/novels/:novelId/decisions/text?chapterId=13
 *
 * 返回拼好的纯文本，直接就是 writer 的 `{DECISIONS}` 输入 ——
 * 这一段是 Actor 和 writer 之间**唯一的接缝**。
 */
actorDecisionController.get('/text', (c) => {
  const novelId = novelIdOf(c)
  if (novelId === null) return c.json({ message: 'novelId 必须是整数' }, 400)
  const chapterId = chapterIdOf(c)
  if (chapterId === null) return c.json({ message: 'chapterId 必填且必须是整数' }, 400)

  return c.json({ chapter_id: chapterId, text: service.buildDecisionsText(chapterId) })
})

/** GET /api/novels/:novelId/decisions?chapterId=13 */
actorDecisionController.get('/', (c) => {
  const novelId = novelIdOf(c)
  if (novelId === null) return c.json({ message: 'novelId 必须是整数' }, 400)
  const chapterId = chapterIdOf(c)
  if (chapterId === null) return c.json({ message: 'chapterId 必填且必须是整数' }, 400)

  return c.json(service.listDecisionsByChapter(chapterId))
})

/**
 * POST /api/novels/:novelId/decisions
 *
 * body 里的 `character` 写的是**名字**（不是 id）—— 那个角色可能还没建卡。
 * 返回的 `reused: true` 表示这次没有新增记录，直接复用了上次同一指纹的裁决。
 */
actorDecisionController.post('/', async (c) => {
  const novelId = novelIdOf(c)
  if (novelId === null) return c.json({ message: 'novelId 必须是整数' }, 400)

  const body = await readJson<SaveActorDecisionDTO>(c)
  if (body === undefined) return c.json({ message: '请求体不是合法 JSON' }, 400)

  try {
    return c.json(service.recordDecision(novelId, body), 201)
  } catch (e) {
    return fail(c, e)
  }
})

/** DELETE /api/novels/:novelId/decisions?chapterId=13 —— 重跑这一章前清干净 */
actorDecisionController.delete('/', (c) => {
  const novelId = novelIdOf(c)
  if (novelId === null) return c.json({ message: 'novelId 必须是整数' }, 400)
  const chapterId = chapterIdOf(c)
  if (chapterId === null) return c.json({ message: 'chapterId 必填且必须是整数' }, 400)

  return c.json({ deleted: service.deleteDecisionsByChapter(chapterId) })
})

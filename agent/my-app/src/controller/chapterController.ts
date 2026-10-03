/**
 * 章纲与正文接口。
 *
 * 挂载点：app.route('/api/novels/:novelId/chapters', chapterController)
 *
 * 注意这里**没有 POST /**：章纲不是单独建的，它随整卷大纲一起提交
 * （POST /api/novels/:novelId/outline/volumes），那样章号连续性和卷边界
 * 才在同一个事务里被校验。单独建章会绕过那套检查。
 */
import { Hono } from 'hono'
import * as service from '../service/chapterService'
import { parseId, novelIdOf, fail, readJson } from '../shared/http'
import type { TextStage, UpdateChapterDTO, SaveChapterTextDTO } from '../../../db/types'

export const chapterController = new Hono()

/* ==================== 列表与待办 ==================== */
// '/pending-demands' 是固定路径，必须写在 '/:chapterId' 前面。

/** GET /api/novels/:novelId/chapters?volumeId=1&from=1&to=50&textStage=final */
chapterController.get('/', (c) => {
  const novelId = novelIdOf(c)
  if (novelId === null) return c.json({ message: 'novelId 必须是整数' }, 400)

  const volumeId = c.req.query('volumeId')
  const from = c.req.query('from')
  const to = c.req.query('to')
  const textStage = c.req.query('textStage')

  try {
    return c.json(
      service.listChapters(novelId, {
        volume_id: volumeId === undefined ? undefined : (parseId(volumeId) ?? undefined),
        from: from === undefined ? undefined : (parseId(from) ?? undefined),
        to: to === undefined ? undefined : (parseId(to) ?? undefined),
        textStage: textStage === undefined ? undefined : (textStage as TextStage),
      }),
    )
  } catch (e) {
    return fail(c, e)
  }
})

/**
 * GET /api/novels/:novelId/chapters/pending-demands
 *
 * 章纲里写了 `NEW:...` 但还没兑现的角色与地点。返回里的 `need` 就是
 * NEW: 后面那段话 —— **正好是 Character / Location agent 的输入**。
 * 这是中心 agent 的待办清单。
 */
chapterController.get('/pending-demands', (c) => {
  const novelId = novelIdOf(c)
  if (novelId === null) return c.json({ message: 'novelId 必须是整数' }, 400)
  return c.json(service.listPendingDemands(novelId))
})

/** GET /api/novels/:novelId/chapters/:chapterId —— 含出场名单与正文状态 */
chapterController.get('/:chapterId', (c) => {
  const id = parseId(c.req.param('chapterId'))
  if (id === null) return c.json({ message: 'chapterId 必须是整数' }, 400)

  const chapter = service.getChapter(id)
  if (!chapter) return c.json({ message: `chapterId=${id} 不存在` }, 404)
  return c.json(chapter)
})

/* ==================== 正文 ==================== */

/** GET /api/novels/:novelId/chapters/:chapterId/texts —— draft 与 final */
chapterController.get('/:chapterId/texts', (c) => {
  const id = parseId(c.req.param('chapterId'))
  if (id === null) return c.json({ message: 'chapterId 必须是整数' }, 400)
  return c.json(service.listChapterTexts(id))
})

/** GET /api/novels/:novelId/chapters/:chapterId/texts/final */
chapterController.get('/:chapterId/texts/:stage', (c) => {
  const id = parseId(c.req.param('chapterId'))
  if (id === null) return c.json({ message: 'chapterId 必须是整数' }, 400)

  const stage = c.req.param('stage')
  if (stage !== 'draft' && stage !== 'final') {
    return c.json({ message: 'stage 只能是 draft 或 final' }, 400)
  }
  const text = service.getChapterText(id, stage)
  if (!text) return c.json({ message: `chapterId=${id} 还没有 ${stage} 正文` }, 404)
  return c.json(text)
})

/**
 * PUT /api/novels/:novelId/chapters/:chapterId/texts
 *
 * 用 PUT 不用 POST：同一 (章, stage) 只有一行，写第二次是覆盖不是新增。
 * 这也是"库里只留现在是什么、不堆历史版本"那条约定的接口形态。
 */
chapterController.put('/:chapterId/texts', async (c) => {
  const id = parseId(c.req.param('chapterId'))
  if (id === null) return c.json({ message: 'chapterId 必须是整数' }, 400)

  const body = await readJson<SaveChapterTextDTO>(c)
  if (body === undefined) return c.json({ message: '请求体不是合法 JSON' }, 400)

  try {
    return c.json(service.saveChapterText(id, body))
  } catch (e) {
    return fail(c, e)
  }
})

/* ==================== 改与删 ==================== */

/** PATCH —— 传了 characters 就整份重建出场名单 */
chapterController.patch('/:chapterId', async (c) => {
  const id = parseId(c.req.param('chapterId'))
  if (id === null) return c.json({ message: 'chapterId 必须是整数' }, 400)

  const body = await readJson<UpdateChapterDTO>(c)
  if (body === undefined) return c.json({ message: '请求体不是合法 JSON' }, 400)

  try {
    const chapter = service.updateChapter(id, body)
    if (!chapter) return c.json({ message: `chapterId=${id} 不存在` }, 404)
    return c.json(chapter)
  } catch (e) {
    return fail(c, e)
  }
})

/** DELETE —— 会级联带走这一章的正文和裁决记录。不可逆 */
chapterController.delete('/:chapterId', (c) => {
  const id = parseId(c.req.param('chapterId'))
  if (id === null) return c.json({ message: 'chapterId 必须是整数' }, 400)
  if (!service.deleteChapter(id)) return c.json({ message: `chapterId=${id} 不存在` }, 404)
  return c.body(null, 204)
})

/**
 * 大纲接口 —— 全项目最重的一个入口。
 *
 * 挂载点：app.route('/api/novels/:novelId/outline', outlineController)
 *
 *   POST /volumes       保存一卷大纲（写 5 张表，一个事务）
 *   GET  /              全篇锚点
 *   GET  /volumes       各卷大纲
 *   GET  /drift         哪几卷的锚点和现在生效的对不上
 *   POST /check-drift   提交前先比一下，不写库
 *
 * 「锚点」的规矩：只由第一卷写死，之后每卷原样回填。后续卷即使传了不同的锚点，
 * 也**不会覆盖**已有的那份，只会把 drift 报出来 —— 漂移是缺陷不是编辑，
 * 我们的活是把它测出来，不是替调用方改掉。
 */
import { Hono } from 'hono'
import * as service from '../service/outlineService'
import { parseId, novelIdOf, fail, readJson } from '../shared/http'
import type { CreateAnchorDTO, SaveVolumeOutlineDTO } from '../../../db/types'

export const outlineController = new Hono()

/* ==================== 锚点 ==================== */

/** GET /api/novels/:novelId/outline —— 全篇锚点 */
outlineController.get('/', (c) => {
  const novelId = novelIdOf(c)
  if (novelId === null) return c.json({ message: 'novelId 必须是整数' }, 400)

  const anchor = service.getAnchor(novelId)
  if (!anchor) return c.json({ message: `novelId=${novelId} 还没有锚点` }, 404)
  return c.json(anchor)
})

/**
 * POST /api/novels/:novelId/outline/anchor
 *
 * 正常流程用不到 —— 保存第一卷大纲时会自动把锚点写死。
 * 留着是为了"卷还没排，先把骨架定下来"。
 * 锚点已存在时会拒绝，不会覆盖。
 */
outlineController.post('/anchor', async (c) => {
  const novelId = novelIdOf(c)
  if (novelId === null) return c.json({ message: 'novelId 必须是整数' }, 400)

  const body = await readJson<CreateAnchorDTO>(c)
  if (body === undefined) return c.json({ message: '请求体不是合法 JSON' }, 400)

  try {
    return c.json(service.saveAnchor({ ...body, novel_id: novelId }), 201)
  } catch (e) {
    return fail(c, e)
  }
})

/* ==================== 卷大纲 ==================== */

/** GET /api/novels/:novelId/outline/volumes */
outlineController.get('/volumes', (c) => {
  const novelId = novelIdOf(c)
  if (novelId === null) return c.json({ message: 'novelId 必须是整数' }, 400)
  return c.json(service.listVolumeOutlines(novelId))
})

/**
 * GET /api/novels/:novelId/outline/volumes/:volumeId
 *
 * 返回里带 `anchorDrift`：这一卷当时回填的锚点和现在生效的是不是一致。
 */
outlineController.get('/volumes/:volumeId', (c) => {
  const volumeId = parseId(c.req.param('volumeId'))
  if (volumeId === null) return c.json({ message: 'volumeId 必须是整数' }, 400)

  const outline = service.getVolumeOutline(volumeId)
  if (!outline) return c.json({ message: `volumeId=${volumeId} 还没有大纲` }, 404)
  return c.json(outline)
})

/**
 * POST /api/novels/:novelId/outline/volumes
 *
 * body 是 SaveVolumeOutlineDTO：卷 + 本卷大纲 + 锚点 + 章纲数组一起提交。
 * 整卷一个事务，失败全回滚 —— 不会留下"一卷只有一半章节"的库。
 *
 * 重跑同一卷是安全的：章节按 idx UPSERT，已写的正文不会被碰。
 * 返回里的 `orphaned` 是"原来属于这一卷、这次名单里没有"的章号，
 * **只报不删** —— 删章会级联带走正文和裁决记录。
 */
outlineController.post('/volumes', async (c) => {
  const novelId = novelIdOf(c)
  if (novelId === null) return c.json({ message: 'novelId 必须是整数' }, 400)

  const body = await readJson<SaveVolumeOutlineDTO>(c)
  if (body === undefined) return c.json({ message: '请求体不是合法 JSON' }, 400)

  try {
    return c.json(service.saveVolumeOutline({ ...body, novel_id: novelId }), 201)
  } catch (e) {
    return fail(c, e)
  }
})

/* ==================== 漂移检查 ==================== */

/** GET /api/novels/:novelId/outline/drift —— 哪几卷的锚点对不上了 */
outlineController.get('/drift', (c) => {
  const novelId = novelIdOf(c)
  if (novelId === null) return c.json({ message: 'novelId 必须是整数' }, 400)
  const drifted = service.listDriftedVolumes(novelId)
  return c.json({ drifted_volume_ids: drifted, count: drifted.length })
})

/** POST /api/novels/:novelId/outline/check-drift —— 提交前先比一比，不写库 */
outlineController.post('/check-drift', async (c) => {
  const novelId = novelIdOf(c)
  if (novelId === null) return c.json({ message: 'novelId 必须是整数' }, 400)

  const body = await readJson<Parameters<typeof service.checkAnchorDrift>[1]>(c)
  if (body === undefined) return c.json({ message: '请求体不是合法 JSON' }, 400)

  try {
    return c.json(service.checkAnchorDrift(novelId, body))
  } catch (e) {
    return fail(c, e)
  }
})

/**
 * 卷接口。
 *
 * 挂载点：app.route('/api/novels/:novelId/volumes', volumeController)
 *
 * 卷是"一次产出"的边界。真正保存一卷**大纲**的入口在 outlineController
 * （POST /api/novels/:novelId/outline/volumes），因为那一次要写 5 张表。
 * 这里的 POST 只建一个空的卷壳 —— 用来先把卷边界定下来。
 */
import { Hono } from 'hono'
import * as service from '../service/volumeService'
import { parseId, novelIdOf, fail, readJson } from '../shared/http'
import type { CreateVolumeDTO, UpdateVolumeDTO } from '../../../db/types'

export const volumeController = new Hono()

/** GET /api/novels/:novelId/volumes —— hasOutline 是现算的 */
volumeController.get('/', (c) => {
  const novelId = novelIdOf(c)
  if (novelId === null) return c.json({ message: 'novelId 必须是整数' }, 400)
  return c.json(service.listVolumes(novelId))
})

/** GET /api/novels/:novelId/volumes/next-no —— 下一卷该编几号 */
volumeController.get('/next-no', (c) => {
  const novelId = novelIdOf(c)
  if (novelId === null) return c.json({ message: 'novelId 必须是整数' }, 400)
  return c.json({ no: service.nextVolumeNo(novelId) })
})

volumeController.get('/:id', (c) => {
  const id = parseId(c.req.param('id'))
  if (id === null) return c.json({ message: 'id 必须是整数' }, 400)

  const volume = service.getVolume(id)
  if (!volume) return c.json({ message: `id=${id} 不存在` }, 404)
  return c.json(volume)
})

volumeController.post('/', async (c) => {
  const novelId = novelIdOf(c)
  if (novelId === null) return c.json({ message: 'novelId 必须是整数' }, 400)

  const body = await readJson<CreateVolumeDTO>(c)
  if (body === undefined) return c.json({ message: '请求体不是合法 JSON' }, 400)

  try {
    return c.json(service.createVolume({ ...body, novel_id: novelId }), 201)
  } catch (e) {
    return fail(c, e)
  }
})

volumeController.patch('/:id', async (c) => {
  const id = parseId(c.req.param('id'))
  if (id === null) return c.json({ message: 'id 必须是整数' }, 400)

  const body = await readJson<UpdateVolumeDTO>(c)
  if (body === undefined) return c.json({ message: '请求体不是合法 JSON' }, 400)

  try {
    const volume = service.updateVolume(id, body)
    if (!volume) return c.json({ message: `id=${id} 不存在` }, 404)
    return c.json(volume)
  } catch (e) {
    return fail(c, e)
  }
})

/** DELETE —— 会级联带走这一卷的大纲、章节，以及章节的正文和裁决。不可逆 */
volumeController.delete('/:id', (c) => {
  const id = parseId(c.req.param('id'))
  if (id === null) return c.json({ message: 'id 必须是整数' }, 400)
  if (!service.deleteVolume(id)) return c.json({ message: `id=${id} 不存在` }, 404)
  return c.body(null, 204)
})

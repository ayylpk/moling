/**
 * 地点接口。
 *
 * 挂载点：app.route('/api/novels/:novelId/locations', locationController)
 *
 * `GET /tree` 是给前端画地图用的 —— 层级挂载的结果。
 * `GET /unresolved` 是反面：parent 写了名字但那个父地点还没建的那些。
 */
import { Hono } from 'hono'
import * as service from '../service/locationService'
import { parseId, novelIdOf, fail, readJson } from '../shared/http'
import type { CreateLocationDTO, UpdateLocationDTO } from '../../../db/types'

export const locationController = new Hono()

/** GET /api/novels/:novelId/locations */
locationController.get('/', (c) => {
  const novelId = novelIdOf(c)
  if (novelId === null) return c.json({ message: 'novelId 必须是整数' }, 400)
  return c.json(service.listLocations(novelId))
})

/** GET /api/novels/:novelId/locations/tree —— 层级树 */
locationController.get('/tree', (c) => {
  const novelId = novelIdOf(c)
  if (novelId === null) return c.json({ message: 'novelId 必须是整数' }, 400)
  return c.json(service.getTree(novelId))
})

/** GET /api/novels/:novelId/locations/unresolved —— 父地点还没建的那些 */
locationController.get('/unresolved', (c) => {
  const novelId = novelIdOf(c)
  if (novelId === null) return c.json({ message: 'novelId 必须是整数' }, 400)
  return c.json(service.listUnresolvedParents(novelId))
})

/** GET /api/novels/:novelId/locations/:id */
locationController.get('/:id', (c) => {
  const id = parseId(c.req.param('id'))
  if (id === null) return c.json({ message: 'id 必须是整数' }, 400)

  const loc = service.getLocation(id)
  if (!loc) return c.json({ message: `id=${id} 不存在` }, 404)
  return c.json(loc)
})

/**
 * POST /api/novels/:novelId/locations
 *
 * parent 写名字。解析不出来不算错 —— 那说明父地点还没建（比如世界观只给了
 * "青州"，先建了"旧观的水井"），建好父地点时回头会自动挂上。
 */
locationController.post('/', async (c) => {
  const novelId = novelIdOf(c)
  if (novelId === null) return c.json({ message: 'novelId 必须是整数' }, 400)

  const body = await readJson<CreateLocationDTO>(c)
  if (body === undefined) return c.json({ message: '请求体不是合法 JSON' }, 400)

  try {
    return c.json(service.createLocation({ ...body, novel_id: novelId }), 201)
  } catch (e) {
    return fail(c, e)
  }
})

locationController.patch('/:id', async (c) => {
  const id = parseId(c.req.param('id'))
  if (id === null) return c.json({ message: 'id 必须是整数' }, 400)

  const body = await readJson<UpdateLocationDTO>(c)
  if (body === undefined) return c.json({ message: '请求体不是合法 JSON' }, 400)

  try {
    const loc = service.updateLocation(id, body)
    if (!loc) return c.json({ message: `id=${id} 不存在` }, 404)
    return c.json(loc)
  } catch (e) {
    return fail(c, e)
  }
})

/** DELETE —— 子地点会被提成根节点（外键是 ON DELETE SET NULL），不会跟着消失 */
locationController.delete('/:id', (c) => {
  const id = parseId(c.req.param('id'))
  if (id === null) return c.json({ message: 'id 必须是整数' }, 400)
  if (!service.deleteLocation(id)) return c.json({ message: `id=${id} 不存在` }, 404)
  return c.body(null, 204)
})

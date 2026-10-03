/**
 * 角色接口。
 *
 * 挂载点：app.route('/api/novels/:novelId/characters', characterController)
 *
 * 两个入口值得留意：
 *   GET /unresolved  —— 关系网里指向了不存在角色的那些条（待建清单的一半）
 *   PUT /:id/relations —— 整份替换关系网，不是增量
 */
import { Hono } from 'hono'
import * as service from '../service/characterService'
import { parseId, novelIdOf, fail, readJson } from '../shared/http'
import type { CreateCharacterDTO, UpdateCharacterDTO, CharacterRole, CharacterStatus } from '../../../db/types'

export const characterController = new Hono()

/* ==================== 列表 ==================== */
// '/unresolved' 是固定路径，必须写在 '/:id' 前面。

/** GET /api/novels/:novelId/characters?role=protagonist&status=alive */
characterController.get('/', (c) => {
  const novelId = novelIdOf(c)
  if (novelId === null) return c.json({ message: 'novelId 必须是整数' }, 400)

  const role = c.req.query('role')
  const status = c.req.query('status')
  try {
    return c.json(
      service.listCharacters(novelId, {
        role: role === undefined ? undefined : (role as CharacterRole),
        status: status === undefined ? undefined : (status as CharacterStatus),
      }),
    )
  } catch (e) {
    return fail(c, e)
  }
})

/** GET /api/novels/:novelId/characters/unresolved —— 关系网里还没接上的人 */
characterController.get('/unresolved', (c) => {
  const novelId = novelIdOf(c)
  if (novelId === null) return c.json({ message: 'novelId 必须是整数' }, 400)
  return c.json(service.listUnresolvedRelations(novelId))
})

/** GET /api/novels/:novelId/characters/:id */
characterController.get('/:id', (c) => {
  const id = parseId(c.req.param('id'))
  if (id === null) return c.json({ message: 'id 必须是整数' }, 400)

  const card = service.getCharacter(id)
  if (!card) return c.json({ message: `id=${id} 不存在` }, 404)
  return c.json(card)
})

/* ==================== 写 ==================== */

/**
 * POST /api/novels/:novelId/characters
 *
 * body 里的 relations 写的是**名字**不是 id。带 `NEW:` 前缀的那些永远不会被
 * 解析成 id —— 它们描述的是一个需求，会一直留在待建清单里直到真的建成卡。
 */
characterController.post('/', async (c) => {
  const novelId = novelIdOf(c)
  if (novelId === null) return c.json({ message: 'novelId 必须是整数' }, 400)

  const body = await readJson<CreateCharacterDTO>(c)
  if (body === undefined) return c.json({ message: '请求体不是合法 JSON' }, 400)

  try {
    // 路径上的 novelId 优先于 body 里的 —— 免得两处写不一样时不知道该信谁
    return c.json(service.createCharacter({ ...body, novel_id: novelId }), 201)
  } catch (e) {
    return fail(c, e)
  }
})

characterController.patch('/:id', async (c) => {
  const id = parseId(c.req.param('id'))
  if (id === null) return c.json({ message: 'id 必须是整数' }, 400)

  const body = await readJson<UpdateCharacterDTO>(c)
  if (body === undefined) return c.json({ message: '请求体不是合法 JSON' }, 400)

  try {
    const card = service.updateCharacter(id, body)
    if (!card) return c.json({ message: `id=${id} 不存在` }, 404)
    return c.json(card)
  } catch (e) {
    return fail(c, e)
  }
})

/** PUT /api/novels/:novelId/characters/:id/relations —— 整份替换 */
characterController.put('/:id/relations', async (c) => {
  const id = parseId(c.req.param('id'))
  if (id === null) return c.json({ message: 'id 必须是整数' }, 400)

  const body = await readJson<{ relations?: { raw: string; attitude: string }[] }>(c)
  if (body === undefined) return c.json({ message: '请求体不是合法 JSON' }, 400)
  if (!Array.isArray(body.relations)) return c.json({ message: 'relations 必须是数组' }, 400)

  try {
    const card = service.replaceRelations(id, body.relations)
    if (!card) return c.json({ message: `id=${id} 不存在` }, 404)
    return c.json(card)
  } catch (e) {
    return fail(c, e)
  }
})

characterController.delete('/:id', (c) => {
  const id = parseId(c.req.param('id'))
  if (id === null) return c.json({ message: 'id 必须是整数' }, 400)
  if (!service.deleteCharacter(id)) return c.json({ message: `id=${id} 不存在` }, 404)
  return c.body(null, 204)
})

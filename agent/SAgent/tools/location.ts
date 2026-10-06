import { tool } from 'langchain'
import * as z from 'zod'

import { location as locationApi } from '../../my-app'
import { novelIdOf, pack } from './context'

/**
 * 地点卡工具 —— 调 my-app 的 location controller。
 *
 * 建好父地点之后要把之前挂在它名下、但当时还解析不到的**子地点**补上
 * （parent_raw 一致、parent_id 为 NULL 的那些），这件事在 my-app 的 service 里。
 * 世界观只铺粗骨架，细粒度地点是剧情里长出来的 —— 「先有儿子后有爹」是常态，不是异常。
 */
export const saveLocation = tool(
  async (input, config) => {
    const { location, created, resolvedChildren } = locationApi.saveLocation(novelIdOf(config), input)

    return pack(created ? `地点已落库｜location_id:${location.id}` : `地点已存在，未重复创建｜location_id:${location.id}`, {
      id: location.id,
      name: location.name,
      parentRaw: location.parentRaw,
      parentId: location.parentId,
      created,
      /** 挂上来的子地点条数 */
      resolvedChildren,
    })
  },
  {
    name: 'save_location',
    description:
      '把一张地点卡写进本小说的库，返回 location_id。名字唯一，同名再存不新建。' +
      '★ parent 写**上级地点的名字**，会自动解析成 id；解析不到就留空（那不是错误，是「父地点还没建」）。' +
      '★ 需要新地点时不要自己编名字，write `NEW:戏剧功能` 让架构师去要 —— 编出来的名字会绕开层级。' +
      '★ 建卡会自动把之前挂在同名父地点下、还没解析的子地点补上（resolvedChildren 是补上的条数）。',
    schema: z.object({
      name: z.string().min(1).describe('地名。'),
      parent: z.string().optional().describe('上级地点的名字（不是 id）。'),
      signature: z.string().optional().describe('一句话独有的记忆点，不得与已有地点同构。'),
      features: z.array(z.string()).optional().describe('3-6 条可感知细节：光、声、气味、质地。'),
      role: z.string().optional().describe('这个地点在故事里承担什么。'),
    }),
  },
)

export const readLocations = tool(
  async ({ id }, config) => {
    const novelId = novelIdOf(config)
    if (id === undefined) {
      const list = locationApi.listLocations(novelId)
      // 只回索引，不回每条 features 全文（那是派活时才取的资料）
      return pack(
        `地点索引（${list.length} 个）`,
        list.map((l) => ({ id: l.id, name: l.name, parentRaw: l.parentRaw, parentId: l.parentId, role: l.role })),
      )
    }
    const location = locationApi.getLocation(novelId, id)
    if (!location) throw new Error(`找不到 location_id=${id}`)
    return pack(`地点卡｜location_id:${id}`, location)
  },
  {
    name: 'read_locations',
    description:
      '读地点。**不带 id**：返回索引（id / 名字 / 上级 / 角色），用来确认该挂到哪个地名下、以及哪些父地点还没建。' +
      '**带 id**：返回那张卡的完整内容。',
    schema: z.object({ id: z.number().int().positive().optional().describe('给 id 就取单张完整卡。') }),
  },
)

export const locationTools = [saveLocation, readLocations]

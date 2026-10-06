import { tool } from 'langchain'
import * as z from 'zod'

import { world as worldApi, type WorldInput } from '../../my-app'
import { novelIdOf, pack } from './context'

/**
 * 世界观工具 —— 调 my-app 的 world controller。
 *
 * 这里没有任何落库细节：places 物化成 locations 根节点、回填挂在骨架名下的孤儿地点、
 * 发记忆，全在 my-app 的 service 里绑定完成。所以走 Agent 落的世界观和走 HTTP 落的
 * 是同一份结果，包括副作用。
 */
export const saveWorld = tool(
  async (input, config) => {
    const world = worldApi.saveWorld(novelIdOf(config), input as WorldInput)
    return pack('世界观已落库', {
      id: world.id,
      version: world.version,
      name: world.name,
      ruleCount: world.rules?.length ?? 0,
      termCount: world.terms?.length ?? 0,
    })
  },
  {
    name: 'save_world',
    description:
      '保存一版小说世界观。修改世界观必须新建版本，旧版本保留；保存后自动进入小说记忆链路。' +
      '★ places 里的地名会一并落进地点表作为根骨架 —— 后面写细粒度地点时，parent 只能填这些名字。' +
      '★ 它只存**硬约束**：规则的三件套（能做到什么 / 代价 / 界线）、专名、禁止清单。',
    schema: z.object({
      name: z.string().min(1),
      premise: z.string().min(1),
      rules: z.array(z.object({ ability: z.string(), cost: z.string(), limit: z.string() })).optional(),
      factions: z.array(z.unknown()).optional(),
      places: z.array(z.unknown()).optional(),
      terms: z.array(z.object({ name: z.string(), note: z.string().optional() })).optional(),
      forbidden: z.array(z.string()).optional(),
    }),
  },
)

export const readWorld = tool(
  async (_input, config) => pack('当前世界观', worldApi.currentWorld(novelIdOf(config))),
  { name: 'read_world', description: '读取当前小说版本号最高的世界观完整内容。', schema: z.object({}) },
)

export const worldTools = [saveWorld, readWorld]

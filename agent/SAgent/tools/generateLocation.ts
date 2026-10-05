import { tool } from 'langchain'
import * as z from 'zod'

import { createLocationAgent } from '../../Location/agent'
import { buildLocationPrompt } from '../../Location/prompt'
import { createLocationRuntime } from '../locationRuntime'
import { pack, renderWorld, withNovelDatabase } from './context'

/**
 * 地点生成工具 —— 把 Location agent 接到中心 Agent 手上（从旧的 run_location_designer 迁来）。
 *
 * 数据源同角色生成：只读当前 per-novel 库（worldRuntime + locationRuntime），
 * 不再走 agent/my-app 的 service。
 *
 * ── 为什么要喂「已有地点」这一段 ──
 * 地点的 parent **只能从已有地名里选**（世界观只铺粗骨架，新地点挂在既有层级下）。
 * 不把已有地名端给模型，它就会现编一个城市或学校 —— 那是一棵挂不上去的平行树，
 * 事后要靠人眼比对才能发现。
 *
 * ── 它不落库 ──
 * 只返回内容；保存走 save_location（采纳与否是中心 Agent 的判断）。
 */
export const generateLocation = tool(
  async ({ need }, config) => {
    const input = withNovelDatabase(config, (database) => {
      const places = createLocationRuntime(database).list()
      return {
        world: renderWorld(database),
        existing: places.length ? places.map((l) => `- ${l.name}（挂在：${l.parentRaw || '—'}）`).join('\n') : '（暂无）',
      }
    })

    const agent = createLocationAgent()
    const res = await agent.invoke({
      messages: [{ role: 'user', content: buildLocationPrompt({ world: input.world, existing: input.existing, need }) }],
    })

    return pack('地点卡（草案，未落库）', res.structuredResponse)
  },
  {
    name: 'generate_location',
    description:
      '造**一个**地点的卡：name / parent（上级地名）/ signature（一眼认得出的标志）/ features（3-6 条可感知细节）/ role（在故事里承担什么）。' +
      '★ parent 只能从已有地名里选，不许另造城市或学校 —— 工具会把已有地名一并给它。' +
      '★ 一次只造一个。' +
      '★ 世界观必须先落库，否则工具会报错。' +
      '★ 它只返回内容，**不落库**；要保存接着调 save_location。',
    schema: z.object({
      need: z.string().describe('这个地点要发生什么戏、为什么必须有它、父级地名是什么。'),
    }),
  },
)

export const locationGenerationTools = [generateLocation]

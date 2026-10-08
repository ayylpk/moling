import { tool } from 'langchain'
import * as z from 'zod'

import { createLocationAgent } from '../../Location/agent'
import { buildLocationPrompt } from '../../Location/prompt'
import { draft as draftApi, location as locationApi } from '../../my-app'
import { flavorOf, novelIdOf, pack, renderWorld } from './context'

/**
 * 地点生成工具 —— 把 Location agent 接到中心 Agent 手上（从旧的 run_location_designer 迁来）。
 *
 * 数据源同角色生成：通过 `agent/my-app` 门面只读当前 per-novel 库
 * （worldRuntime + locationRuntime），不直接越级访问 service。
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
    const novelId = novelIdOf(config)
    const places = locationApi.listLocations(novelId)
    const input = {
      world: renderWorld(novelId),
      existing: places.length ? places.map((l) => `- ${l.name}（挂在：${l.parentRaw || '—'}）`).join('\n') : '（暂无）',
    }

    const agent = createLocationAgent(undefined, flavorOf(config))
    const res = await agent.invoke({
      messages: [{ role: 'user', content: buildLocationPrompt({ world: input.world, existing: input.existing, need }) }],
    })

    const card = res.structuredResponse as { name?: string } | undefined
    // 草案先落 drafts 表（stage='cast'，按名字记账）：采纳（save_location / 页面按钮）才有对象
    const key = String(card?.name ?? '').trim() || `need:${need.slice(0, 24)}`
    const stored = draftApi.saveDraft(novelId, 'cast', key, card ?? {})
    return pack(`地点卡（待审核草案，未落库｜${stored.updatedAt}）`, card)
  },
  {
    name: 'generate_location',
    description:
      '造**一个**地点的卡：name / parent（上级地名）/ signature（一眼认得出的标志）/ features（3-6 条可感知细节）/ role（在故事里承担什么）。' +
      '★ parent 只能从已有地名里选，不许另造城市或学校 —— 工具会把已有地名一并给它。' +
      '★ 一次只造一个。' +
      '★ 世界观必须先落库，否则工具会报错。' +
      '★ 它会把结果存为**待审核草案**，不落正式表；调用完必须停下交作者审核，他采纳后（下一轮）才能调 save_location。一轮不许再发起第二个生成动作。',
    schema: z.object({
      need: z.string().describe('这个地点要发生什么戏、为什么必须有它、父级地名是什么。'),
    }),
  },
)

export const locationGenerationTools = [generateLocation]

import { tool } from 'langchain'
import * as z from 'zod'

import { createWorldAgent, parseWorld } from '../../story-planner/agent'
import { novelOf, pack } from './context'

/**
 * 世界观生成工具 —— 把世界 agent 接到中心 Agent 手上（从旧的 run_world_planner 迁来）。
 *
 * ── 它是整条创作链的起点 ──
 * 角色、地点、大纲、正文全都以世界观为硬约束，所以在它落库之前，**别的生成工具都会报错**
 * （它们调 renderWorld，读不到世界观就直接抛）。中心 Agent 的顺序表第 2 步就是它。
 *
 * ── 它不读 per-novel 库（与另外三个生成工具不同）──
 * 生成世界观的时候，库里还没有任何下游资料可读——它是地基，地基之上还没东西。
 * 所以这里不开 novel.sqlite，只从目录库取这本书的题材/书名/文风当背景。
 * 这不是为了省一次连接，是因为**没有可读的东西**：硬塞一次空读只会让人以为读了什么。
 *
 * ── 它不落库 ──
 * 与另外三个生成工具同一条规矩：生成与落库是两个动作，采纳与否是中心 Agent 的决定。
 * 生成了不满意就重生成（库没被污染），落库失败也不用重新生成（生成贵、落库便宜）。
 *
 * ── 为什么要在这里补一个 name ──
 * 世界 agent 的 schema 里没有 name（它只产设定），而 save_world 落库时 name 是必填。
 * 与其让中心 Agent 每次落库前自己补，不如在这里补好——它返回的就是一份**能直接交给
 * save_world 的完整输入**。显式传的名字优先，没传就用书名兜底。
 */
export const generateWorld = tool(
  async ({ need, name }, config) => {
    const novel = novelOf(config)

    const agent = createWorldAgent()
    const res = await agent.invoke({
      messages: [
        {
          role: 'user',
          content: [
            `这是一本【${novel.genre || '题材未定'}】的长篇，书名《${novel.title || novel.slug}》。`,
            novel.style ? `文风基准：${novel.style}` : '',
            '',
            '这本书要什么样的世界：',
            need,
          ]
            .filter(Boolean)
            .join('\n'),
        },
      ],
    })

    const world = parseWorld(res.structuredResponse)
    return pack('世界观草案（未落库）', { name: name?.trim() || novel.title || novel.slug, ...world })
  },
  {
    name: 'generate_world',
    description:
      '生成整本书的世界观圣经：premise（一句话前提）、rules（能做什么/代价/界线，三件套）、factions（势力）、places（地名粗骨架）、terms（专名表）、forbidden（禁止清单）。' +
      '★ **这是整条链的起点**：世界观落库之前，角色 / 地点 / 大纲生成都会报错，因为它们都以它为硬约束。' +
      '★ need 里要交代：题材、口味、这个世界必须写死的规则（例如「穿越必须付出代价」）、必须禁止的东西。' +
      '★ rules 的每一条都必须带代价——没有代价的规则就是外挂，这是这套世界观设计的核心。' +
      '★ 改世界观等于改地基：下游已产出的内容都要重跑。定了就不要反复改。' +
      '★ 它只返回内容，**不落库**；要保存接着调 save_world（返回的结果可直接喂给它，name 已补好）。',
    schema: z.object({
      need: z
        .string()
        .describe('这本书要什么样的世界：题材、口味、必须写死的规则、必须禁止的东西、势力格局。'),
      name: z
        .string()
        .optional()
        .describe('这个世界/地界叫什么名字。落库时 save_world 需要它；不传就用书名兜底。'),
    }),
  },
)

/** 单独导出，方便在数组里改挂载顺序 */
export const worldGenerationTools = [generateWorld]

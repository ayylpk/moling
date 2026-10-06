import { tool } from 'langchain'
import * as z from 'zod'

import { createCharacterAgent } from '../../Character/agent'
import { buildCharacterPrompt } from '../../Character/prompt'
import { character as characterApi } from '../../my-app'
import { novelIdOf, novelOf, pack, renderWorld } from './context'

/**
 * 角色生成工具 —— 把 Character agent 接到中心 Agent 手上（从旧的 run_character_designer 迁来）。
 *
 * ── 迁移改了什么 ──
 * 旧工具读资料走 `agent/my-app/src/service/*`（那是 resources/myapp.sqlite，另一个库）。
 * 现在**只读当前 per-novel 库**：
 *   · 世界观取 `worldRuntime.current()`
 *   · 已有角色取 `characterRuntime`（生成的卡要能和场上的人对得上）
 * 数据源只有一个 —— 这正是这次迁移要收掉的东西。
 *
 * ── 它不落库 ──
 * 生成与落库是**两个动作**，采纳与否是中心 Agent 的决定：
 * 生成不满意就重生成，库没被污染；落库失败也不用重新生成（生成贵、落库便宜）。
 * 所以这里**只返回内容**，保存走 save_character。
 *
 * ── 为什么资料取完就关库再调模型 ──
 * 喂给子 agent 的资料是同步取尽的，模型调用期间不再需要连接。
 * 把库开着陪模型跑没有好处，只多占一个句柄。
 *
 * ── 为什么一次只造一个 ──
 * 批量造从第三五个起必然退化成模板（实测过）。要几个就调几次。
 */
export const generateCharacter = tool(
  async ({ need }, config) => {
    // ① 同步取资料（这一跳结束就关库）
    const novelId = novelIdOf(config)
    const existing = characterApi.listCharacterBriefs(novelId)
    const input = {
      world: renderWorld(novelId),
      style: novelOf(config).style || '无特别文风要求。',
      // 已有角色附在 need 后面：模型看不到库，不给就等于让它闭着眼睛重复造人
      existing: existing.length ? existing.map((c) => `${c.name}（${c.role}）`).join(' / ') : '（尚未建立角色）',
    }

    // ② 调角色 agent（它拿到的只是几段文本，没有任何数据库连接）
    const agent = createCharacterAgent()
    const res = await agent.invoke({
      messages: [
        {
          role: 'user',
          content: buildCharacterPrompt({
            world: input.world,
            need: `${need}\n\n★ 场上已有角色（不要重复造，需要关系就写进 relations）：${input.existing}`,
            style: input.style,
          }),
        },
      ],
    })

    return pack('角色卡（草案，未落库）', res.structuredResponse)
  },
  {
    name: 'generate_character',
    description:
      '造**一个**角色的完整卡：voice（说话方式）、want/cost/need（欲望与代价）、flaw（会让他选错的缺陷）、line（底线）、immutable（不可改的可感知事实）、relations（对别人的态度）。' +
      '★ 一次只造一个：批量造会从第三五个开始退化成模板。' +
      '★ 世界观必须先落库（角色以世界为硬约束），否则工具会报错。' +
      '★ 它会带上场上已有角色的名单，避免重复造人。' +
      '★ 它只返回内容，**不落库**；要保存接着调 save_character（采纳与否由你判断）。',
    schema: z.object({
      need: z.string().describe('这个角色是谁、要承担什么戏剧功能、和已有角色什么关系。'),
    }),
  },
)

/** 单独导出，方便在数组里改挂载顺序 */
export const characterGenerationTools = [generateCharacter]

import { tool } from 'langchain'
import * as z from 'zod'

import { createActorAgent, type Actor, type ActorScene } from '../../Actor/agent'
import { buildActorPrompt } from '../../Actor/prompt'
import { character as characterApi } from '../../my-app'
import { flavorOf, novelIdOf, pack } from './context'

/**
 * 角色裁决生成工具 —— 把 Actor agent 接到中心 Agent 手上（从旧的 run_character_actor 迁来）。
 *
 * ── 迁移改了什么 ──
 * 旧版本曾直接读取 `characterService`。现在通过 `agent/my-app` 门面只读当前 per-novel
 * 库的 `characters` 表，按名字取卡。
 *
 * ── 它给模型的切片 = 「他此刻自己知道的」+「他自己的驱动力」 ──
 * 只注入 voice / want / cost / need / flaw / line / immutable。
 * **刻意不给 arc / reveal / secret**：
 *   · arc 的终点给了他就会直奔终点，模拟立刻退化成"读答案"；
 *   · reveal 是未来的触发条件，给了等于剧透；
 *   · secret 由 story 间接表达（他知道的才写进 story），不直接说"他在瞒什么"。
 * 多给一样都会让模拟失真——这不是保守，这是这个工具唯一的价值所在。
 *
 * ── relations 为空，是如实反映现状 ──
 * per-novel 的 characters 表**没有 relations 列**（角色关系表还没建，关系网工具也还没挂），
 * 所以这里只能给空数组。关系表尚未纳入当前业务模型。
 * 这里不假装有——裁决仍然有效，只是"对在场者的既有态度"这一层要写进 situation。
 *
 * ── 它不落库 ──
 * 只返回裁决草案；保存走 save_actor_decision（那里的 prompt_hash 决定同一次提问会不会复用）。
 */
export const generateDecision = tool(
  async ({ name, story, situation, options, chatPrompt }, config) => {
    // ① 同步取卡（这一跳结束就关库；模型调用期间不需要连接）
    const full = characterApi.getCharacterByName(novelIdOf(config), name)
    const actor = ((full): Actor => {
      if (!full) {
        throw new Error(
          `找不到角色「${name}」。先用 generate_character 造出来、save_character 落库，再调裁决。`,
        )
      }
      return {
        name: full.name,
        voice: full.voice ?? '',
        want: full.want ?? '',
        cost: full.cost ?? '',
        need: full.need ?? '',
        flaw: full.flaw ?? '',
        line: full.line ?? '',
        immutable: full.immutable ?? [],
        relations: [],
        knows: [],
      }
    })(full)

    // ② 调 Actor agent（它拿到的只是几段文本，没有任何数据库连接）
    const scene: ActorScene = { story, situation, options, chatPrompt }
    const agent = createActorAgent(undefined, flavorOf(config))
    const res = await agent.invoke({
      messages: [{ role: 'user', content: buildActorPrompt({ actor, scene }) }],
    })

    return pack(`角色裁决（${actor.name}，草案未落库）`, res.structuredResponse)
  },
  {
    name: 'generate_decision',
    description:
      '扮演**一个**角色，回答「他此刻会怎么选」。输入是他自己知道的前情、此刻的处境、三个具体选项（A/B/C），以及一个 D 让他自己给答案。' +
      '返回：选了哪个（A/B/C/D）、是角色卡上哪个字段决定的（want/need/flaw/line/cost）、以及他此刻会说的那一句话。' +
      '★ 只在**真正的岔路口**调用——他的 want 和 need 互相拉扯、或者他的 flaw 会让他选错的时候。不要每章都调。' +
      '★ **绝对不要**把大纲的预期结果写进 story / situation / options：它必须盲选，' +
      '否则它只会顺着你的预期答「对」，而且不会报错，只会安静地失效。' +
      '★ story 里只写**这个角色知道的**部分（他不知道的写进去，模拟就不可信了）。' +
      '★ 角色卡必须先落库（它按名字去库里取卡），否则工具会报错。' +
      '★ 它只返回内容，**不落库**；要保存接着调 save_actor_decision。',
    schema: z.object({
      name: z.string().describe('要扮演哪个角色（用角色卡上的名字）。'),
      story: z.string().describe('此前发生了什么。只写这个角色知道的部分。'),
      situation: z.string().describe('此刻他面临的选择是什么。'),
      options: z
        .object({ A: z.string(), B: z.string(), C: z.string() })
        .describe('三个具体选项。要具体到动作和话，不要写抽象方向。'),
      chatPrompt: z.string().describe('D 的题面：三个选项都不对时，让他自己给一个新答案。'),
    }),
  },
)

/** 单独导出，方便在数组里改挂载顺序 */
export const decisionGenerationTools = [generateDecision]

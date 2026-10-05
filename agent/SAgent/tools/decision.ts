import { tool } from 'langchain'
import * as z from 'zod'

import { saveActorDecisionWithMemory } from '../../storage/novelEffects'
import { createDecisionRuntime, type DecisionInput } from '../decisionRuntime'
import { pack, withNovelDatabase } from './context'

/**
 * 角色裁决工具。
 *
 * 这张表是整条流水线里 Actor 与 writer 之间的**唯一接缝**：Actor 的答案经它进 writer 的提示。
 * 没有它，正文里就会出现"主角突然做了他不会做的事"。
 *
 * ── prompt_hash 是省钱的机关 ──
 * 拿同一份情境（同一 prompt_hash）再问一次，直接返回上次的裁决（reused=true），
 * 不新增记录、也不重新问 Actor。重跑一章是常事，这一步省下的是真调用。
 */
export const saveActorDecision = tool(
  async (input, config) =>
    withNovelDatabase(config, (database, novel) => {
      const saved = saveActorDecisionWithMemory(database, novel.id, {
        chapterIdx: input.chapter_idx,
        characterName: input.character_name,
        situation: input.situation,
        options: input.options,
        choice: input.choice,
        reason: input.reason,
        line: input.line,
        customAnswer: input.custom_answer,
        promptHash: input.prompt_hash,
      } as DecisionInput)
      return pack(saved.reused ? '裁决已存在，直接复用（没有新增记录）' : '裁决已落库', {
        decision_id: saved.decision.id,
        chapter_idx: input.chapter_idx,
        character: saved.decision.characterName ?? '（未建卡的角色）',
        choice: saved.decision.choice,
        reused: saved.reused,
      })
    }),
  {
    name: 'save_actor_decision',
    description:
      '把 Actor 的一次裁决记下来，供写正文时当硬约束用。' +
      '★ 同一个 prompt_hash 会**直接复用**旧记录（reused=true），不会重复问、也不新增行。' +
      '★ character_name 写**角色名**；卡还没建也能记（character_id 留空），但名字必须是章纲里写的那个。' +
      '★ choice 选 D 时必须给 custom_answer（D = 角色说了选项外的话），否则这次裁决没有结论。' +
      '★ 裁决的内容要出自 Actor 的产出，**不要自己替角色做决定**。',
    schema: z.object({
      chapter_idx: z.number().int().positive().describe('第几章。'),
      character_name: z.string().min(1).describe('角色名。'),
      situation: z.string().min(1).describe('他面对的情境。'),
      options: z.object({
        A: z.string().min(1),
        B: z.string().min(1),
        C: z.string().min(1),
        chatPrompt: z.string().optional().describe('D 的题面：允许角色说出选项外的答案。'),
      }),
      choice: z.enum(['A', 'B', 'C', 'D']),
      reason: z.string().optional().describe('他为什么这么选。'),
      line: z.string().optional().describe('他会说的那句话。'),
      custom_answer: z.string().optional().describe('choice=D 时必填。'),
      prompt_hash: z.string().min(1).describe('这一次问的输入指纹；用于判断"这一问是不是问过了"。'),
    }),
  },
)

export const readActorDecisions = tool(
  async ({ chapter_idx }, config) =>
    withNovelDatabase(config, (database) => {
      const block = createDecisionRuntime(database).buildDecisionsText(chapter_idx)
      return pack(`第 ${chapter_idx} 章裁决（${block.count} 条）`, block.text)
    }),
  {
    name: 'read_actor_decisions',
    description:
      '读某一章的裁决，返回**可以直接进写正文那段提示词**的文本（用角色名，不是 id）。' +
      '★ 写这一章之前读它：writer 必须按这些裁决写，否则角色会做出他不会做的事。' +
      '★ 没有裁决时返回的是一句明确的"无"，表示这一章没有分叉点、按角色卡自由发挥 —— 那不是缺失。',
    schema: z.object({ chapter_idx: z.number().int().positive().describe('第几章。') }),
  },
)

export const decisionTools = [saveActorDecision, readActorDecisions]

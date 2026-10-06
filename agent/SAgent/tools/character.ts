import { tool } from 'langchain'
import * as z from 'zod'

import { character as characterApi, type CharacterInput } from '../../my-app'
import { novelIdOf, pack } from './context'

/**
 * 角色卡工具 —— 调 my-app 的 character controller。
 *
 * 这个工具里**没有落库逻辑，也没有记忆逻辑**：建卡之后要回头把章纲里同名未解析的
 * 出场记录补上（chapter_cast.character_id 落 NULL 的那些）、要发记忆，这两件都在
 * my-app 的 service 里。少了前者，"章纲先写了林晚、卡后来才建"这条最常见的路径上
 * 待办永远清不掉；少了后者，同一本书经 HTTP 落库就与经 Agent 落库不一样。
 *
 * 所以这里只做三件事：认出是哪本书、调一次、给结果包个标签。
 * 角色关系网（character_relations）**本期不实现**，所以没有解析关系的动作。
 */
export const saveCharacter = tool(
  async (input, config) => {
    const { character, created, resolvedCast } = characterApi.saveCharacter(novelIdOf(config), input as CharacterInput)

    return pack(created ? `角色已落库｜character_id:${character.id}` : `角色已存在，未重复创建｜character_id:${character.id}`, {
      id: character.id,
      name: character.name,
      role: character.role,
      status: character.status,
      created,
      /** 补上了几条章纲里的出场引用 */
      resolvedCast,
    })
  },
  {
    name: 'save_character',
    description:
      '把一张角色卡写进本小说的库，返回 character_id。' +
      '★ 名字唯一：同名再存不会新建，直接返回已有那张（created=false）。' +
      '★ 建卡会自动把章纲里写着这个名字、还没解析的出场记录补上（resolvedCast 是补上的条数）。' +
      '★ 这里存的是**固定设定**；随剧情变的画像由记忆链路自动维护，不要往这里写。' +
      '★ relations（角色关系网）本期不支持，不要传。',
    schema: z.object({
      name: z.string().min(1),
      role: z.enum(['protagonist', 'antagonist', 'support']),
      immutable: z.array(z.string()).optional().describe('不可改的可感知事实（身体、出身）。'),
      voice: z.string().optional().describe('说话方式。'),
      want: z.string().optional().describe('表层欲望。'),
      cost: z.string().optional().describe('愿意为它付出的代价。'),
      need: z.string().optional().describe('深层需求。'),
      secret: z.string().optional(),
      reveal: z.string().optional().describe('秘密的暴露条件。'),
      line: z.string().optional().describe('底线：越线即翻脸。'),
      flaw: z.string().optional(),
      arc: z.object({ start: z.string().optional(), end: z.string().optional() }).optional().describe('弧光起点与终点。'),
      status: z.enum(['alive', 'dead', 'disabled']).optional(),
      source: z.enum(['agent', 'hand']).optional().describe('agent=模型生成，hand=人工定的（主角通常是 hand）。'),
    }),
  },
)

export const readCharacters = tool(
  async ({ id }, config) => {
    const novelId = novelIdOf(config)
    // 不带 id = 索引（谁在场）；带 id = 一张完整卡
    if (id === undefined) {
      const briefs = characterApi.listCharacterBriefs(novelId)
      return pack(`角色索引（${briefs.length} 个）`, briefs)
    }
    const character = characterApi.getCharacter(novelId, id)
    if (!character) throw new Error(`找不到 character_id=${id}`)
    return pack(`角色卡｜character_id:${id}`, character)
  },
  {
    name: 'read_characters',
    description:
      '读角色。**不带 id**：返回索引（id / 姓名 / 定位 / 状态），用来确认场上已经有谁 —— 派活前先用它，避免另造一个同功能的人。' +
      '**带 id**：返回那一张卡的完整内容（改卡前先读它）。',
    schema: z.object({ id: z.number().int().positive().optional().describe('给 id 就取单张完整卡。') }),
  },
)

export const characterTools = [saveCharacter, readCharacters]

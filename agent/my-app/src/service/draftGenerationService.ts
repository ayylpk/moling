import { createModel } from '../../../create_model'
import { createWorldAgent, parseWorld } from '../../../story-planner/agent'
import { createArchitectAgent } from '../../../Architect/agent'
import { buildArchitectPrompt } from '../../../Architect/prompt'
import { listNovelsInCatalog } from '../db/connection'
import { renderWorldText } from './worldText'
import { listCharacterBriefs } from '../controller/characterController'

/**
 * 草案生成 service —— 「生成一份草案」的模型调用，供两个入口共用：
 *   · 中心 Agent 的 generate_* 工具（工具层已改为在这里取内容，再顺手存草案）
 *   · 前端页面按钮走的 HTTP 草案接口（draftController）
 *
 * 两个入口必须喂给子 agent **同一份资料、同一套提示词**，否则按钮生成的和
 * Agent 生成的会是两种东西。这里只负责"调子 agent 产内容"，**不落任何库**
 * —— 存草案、采纳落库都在 draftController / draftService。
 */

/** 世界观草案内容：直接就是一份能落库的 WorldInput（name 在这里补好）。 */
export const generateWorldDraftContent = async (
  novelId: number,
  need: string,
  name?: string,
): Promise<Record<string, unknown>> => {
  const novel = listNovelsInCatalog().find((item) => item.id === novelId)
  if (!novel) throw new Error(`小说不存在：novelId=${novelId}`)

  const agent = createWorldAgent(undefined, { style: novel.style, genre: novel.genre })
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
  return { name: name?.trim() || novel.title || novel.slug, ...world }
}

/** 卷纲草案内容：Architect 产出的 direction / structure / pacing / constraints / chapters。 */
export const generateOutlineDraftContent = async (
  novelId: number,
  input: { range: string; need: string; previous?: string },
): Promise<{
  direction: { logline: string; theme: string; coreConflict: string; endingDirection: string }
  structure: { type: string; acts?: unknown[]; turningPoints?: unknown[]; mainPlot: unknown; subplots?: unknown[] }
  pacing: unknown
  constraints: unknown
  chapters: Array<Record<string, unknown>>
}> => {
  const novel = listNovelsInCatalog().find((item) => item.id === novelId)
  if (!novel) throw new Error(`小说不存在：novelId=${novelId}`)

  // 世界观没落库时 renderWorldText 会直接抛 —— 大纲以它为硬约束，不硬生成
  const world = renderWorldText(novelId)
  const cast = listCharacterBriefs(novelId)

  // 架构师要一口气写一段，输出额度给足；温度沿用 0.5
  const agent = createArchitectAgent(createModel(0.5, 180_000, false, 8192), { style: novel.style, genre: novel.genre })
  const res = await agent.invoke({
    messages: [
      {
        role: 'user',
        content: buildArchitectPrompt({
          world,
          characters: cast.length ? cast.map((c) => `${c.name}（${c.role}）`).join(' / ') : '（尚未建立角色）',
          previous: input.previous || '本卷为第一卷，从第 1 章开始。此前无任何已写内容，全篇锚点由本卷定稿。',
          style: novel.style || '无特别文风要求。',
          need: `${input.need}\n\n★ 本次调用只输出 ${input.range} 的章纲，不要越界去写别的章。`,
        }),
      },
    ],
  })

  const outline = res.structuredResponse
  if (!outline?.chapters?.length) throw new Error('架构师没有返回任何章纲，草案无效')
  return outline
}

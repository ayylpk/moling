import { tool } from 'langchain'
import * as z from 'zod'

import { createModel } from '../../create_model'
import { createArchitectAgent } from '../../Architect/agent'
import { buildArchitectPrompt } from '../../Architect/prompt'
import { createCharacterRuntime } from '../characterRuntime'
import { pack, renderWorld, withNovelDatabase } from './context'

/**
 * 大纲生成工具 —— 把 Architect agent 接到中心 Agent 手上（从旧的 run_outline_architect 迁来）。
 *
 * 数据源：只读当前 per-novel 库（worldRuntime + characterRuntime）。
 *
 * ── 一次只排一卷，而且要分 range ──
 * 一卷约 50 章。50 章章纲一次吐会撞 deepseek 的 8192 输出上限被**截断**，
 * 而且截断点在中间 —— 前面写好的也一起废掉。所以必须用 range 分段调，每段自己把
 * 已定稿的锚点和此前摘要塞进 previous。
 *
 * ── range 为什么由调用方给，而不是工具自己算 ──
 * "该排到第几章"取决于本卷要交付什么，那是中心 Agent 的判断，不是工具能推的。
 * 工具只负责把这条约束**写进提示词**（那句"不要越界"不是客套：模型很容易顺手把
 * 后面几卷的戏提前写完，那不是这次调用该干的事）。
 *
 * ── 它不落库 ──
 * 只返回内容；落库走 save_volume_outline（卷 + 锚点 + 卷纲）+ save_chapter_outline（逐章）。
 * 采纳与否、以及要不要接受它回填的锚点，是中心 Agent 的决定 —— 漂移检查就建立在这一点上。
 */
export const generateOutline = tool(
  async ({ range, need, previous }, config) => {
    const input = withNovelDatabase(config, (database, novel) => {
      const cast = createCharacterRuntime(database).list()
      return {
        world: renderWorld(database),
        characters: cast.length ? cast.map((c) => `${c.name}（${c.role}）`).join(' / ') : '（尚未建立角色）',
        style: novel.style || '无特别文风要求。',
      }
    })

    // 架构师要一口气写一卷，输出额度给足；温度沿用 0.5
    const agent = createArchitectAgent(createModel(0.5, 180_000, false, 8192))
    const res = await agent.invoke({
      messages: [
        {
          role: 'user',
          content: buildArchitectPrompt({
            world: input.world,
            characters: input.characters,
            previous:
              previous || '本卷为第一卷，从第 1 章开始。此前无任何已写内容，全篇锚点由本卷定稿。',
            style: input.style,
            need: `${need}\n\n★ 本次调用只输出 ${range} 的章纲，不要越界去写别的章。`,
          }),
        },
      ],
    })

    return pack(`卷大纲草案（${range}）`, res.structuredResponse)
  },
  {
    name: 'generate_outline',
    description:
      '排**一卷**（约 50 章）的大纲：本卷的 acts（起承转合）、turningPoints（转折点落在第几章）、pacing（张力曲线）、constraints（一致性约束）、以及逐章章纲。' +
      '★ 一次调用 = 一卷，按卷序调用。' +
      '★ 必须用 range 分段（如「第 1–13 章」）——一次吐 50 章会撞输出上限被截断，截断点在中间，前面写好的也废了。' +
      '后续分段的 previous 里要带上已定稿的锚点和此前章节的摘要。' +
      '★ 全篇级字段（direction / structure.type / mainPlot / subplots）由**第一卷定稿**，后续卷必须原样回填、一个字都不许改 —— 这是防设定漂移的检查点。' +
      '★ 世界观和本卷要用到的角色卡都必须已落库，否则它只能现编人名；工具会把场上角色一并给它。' +
      '★ 它只返回内容，**不落库**；要保存接着调 save_volume_outline（卷 + 锚点 + 卷纲），再逐章 save_chapter_outline。',
    schema: z.object({
      range: z.string().describe('本次只出哪些章，例如「第 1–13 章」。必须写，防止一次吐 50 章被截断。'),
      need: z.string().describe('本卷要交付什么：本卷的戏剧任务、必须发生的转折、要埋 / 要收的伏笔。'),
      previous: z.string().describe('已写前情 + 已定稿的全篇锚点（逐字回填）+ 本卷起始章号。第一卷留空即可。'),
    }),
  },
)

export const outlineGenerationTools = [generateOutline]

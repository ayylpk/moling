import { tool } from 'langchain'
import * as z from 'zod'

import { chapter as chapterApi } from '../../my-app'
import { novelIdOf } from './context'
import { diagnoseRhythm, novelFlavorOf, paragraphChangeRate, runProseGeneration } from '../../my-app/src/service/proseGeneration'

/**
 * generate_chapter 工具 —— 中心 Agent 的单次章节入口。
 *
 * ── 实现都搬去了哪里 ──
 * 整条生成链（取材裁剪 / 执笔扩写兜底 / 两遍润色 / 润色空转闸门 / 指纹复用）在
 * `my-app/src/service/proseGeneration.ts`，因为前端"生成当前章正文"按钮走的是
 * **同一条链**，两条路必须逐字一致。这里只剩一层壳。
 *
 * ── 产出止于待审核草案 ──
 * 工具跑完**不写终稿**：润色稿存进 drafts 表（stage='prose'），由作者审核后
 * 采纳（采纳才写 final、才进记忆链路）。生成失败（含润色空转）不产生任何正式数据。
 */

// 重新导出：节奏诊断与改写率的历史测试直接从这里引（实现住在新家）
export { diagnoseRhythm, paragraphChangeRate }

export const generateChapterTool = tool(
  async ({ chapterIdx, previous, decisions }, config) => {
    const novelId = novelIdOf(config)
    const novel = novelOfForFlavor(novelId)

    // 一次开库跑完整条链：plan → claim → 执笔 → draft → 润色 → 草案 → 收尾。
    // 中间夹着两次模型调用，逐步开库关库既慢，也让「这一章的多个步骤」没有同一个事务视角。
    const result = await chapterApi.withChapterConnection(novelId, (ctx) =>
      runProseGeneration(ctx, { novelId, chapterIdx, previous, decisions, novel }),
    )

    return JSON.stringify(result, null, 2)
  },
  {
    name: 'generate_chapter',
    description:
      '生成**一章**正文：读库取材（世界观 / 本章出场角色 / 地点 / 章纲）→ 执笔 → 存初稿 → 两遍润色 → 润色稿存为**待审核草案**。' +
      '★ 一次只生成一章，生成完立即停止，把草案交给作者审核 —— 他确认采纳后终稿才落库（save 不在这里）。' +
      '★ 章纲必须先存在（save_chapter_outline 落库）。没有章纲就没有这一章——' +
      '这时要说清是缺章纲（并建议先把这一卷的大纲排出来），而不是硬生成。' +
      '★ previous：第 1 章留空；第 N 章（N>1）一定要给上一章结尾状态与相关伏笔的当前情况。' +
      '★ decisions：本章有真正的岔路口时，先 generate_decision，再把裁决结果传进来；没有就留空。' +
      '★ 返回 status: failed 时把 error 如实转告作者，不许说"已经生成"。',
    schema: z.object({ chapterIdx: z.number().int().positive(), previous: z.string().optional(), decisions: z.string().optional() }),
  },
)

/** 取这本书的题材与文风（走目录库，与生成链同源）。 */
const novelOfForFlavor = (novelId: number): { genre: string; style: string } => {
  const flavor = novelFlavorOf(novelId)
  return { genre: flavor.genre, style: flavor.style }
}

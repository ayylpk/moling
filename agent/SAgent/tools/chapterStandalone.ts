import { tool } from 'langchain'
import type { RunnableConfig } from '@langchain/core/runnables'
import * as z from 'zod'
import { chapter as chapterApi, writing as writingApi, type ChapterContext, type ChapterOutline } from '../../my-app'
import { createModel } from '../../create_model'
import { createWriterAgent } from '../../writer/agent'
import { buildWriterPrompt } from '../../writer/prompt'
import { createPolisherAgent } from '../../Polisher/agent'
import { buildPolisherPrompt } from '../../Polisher/prompt'
import { createChapterWorkflow, type ChapterDraft, type ChapterPolish } from '../chapterWorkflow'
import { flavorOf, novelIdOf, novelOf } from './context'

/**
 * 润色重试的追加句。
 *
 * 单独拼在 buildPolisherPrompt 的结果后面，而不是写进 POLISHER_PROMPT ——
 * 「上一次一个字都没改」这句话**只对第二遍成立**，常驻在系统提示里会让第一遍
 * 去改动本来没问题的地方。红线（NO_AI_VOICE）在系统提示里，不受这里影响。
 */
const RETRY_NOTE = '★ 注意：你上一次一个字都没改，这不合格。这一遍必须真的动 —— 上一版里机器味最重的地方，就是你要动的地方。'
/**
 * 前情：调用方给了就用它；没给且不是第一章，就从库里取上一章的摘要与结尾状态。
 *
 * ── 为什么要有这个兜底 ──
 * 中心 Agent 的编排说明里写了「只调一次 generate_chapter(chapterIdx=章号)」，
 * previous 是个可选参数，于是常常不传。而 writerPrompt 里写的是
 * `previous || '这是开篇，没有前情。'` —— 于是第 2 章被当成开篇写：
 * 它读不到第 1 章末尾那个还没解释的钩子，衔接就断了。
 *
 * 而且**不会报错**。第 2 章本身自洽（章纲说要找实物证据，它就去翻抽屉），
 * 只是和第 1 章对不上。校验的人往往只逐章看，看不出两章之间少了东西。
 *
 * 兜底只能给到摘要和结尾状态，够接钩子、不够接细腻的情绪。
 * 所以 skill 里仍然要求中心 Agent 自己写 —— 两层都留着。
 */
const resolvePrevious = (
  runtime: Pick<ChapterContext, 'getText'>,
  chapterIdx: number,
  given?: string,
): string => {
  if (given?.trim()) return given.trim()
  if (chapterIdx <= 1) return ''
  const prior = runtime.getText(chapterIdx - 1, 'final') ?? runtime.getText(chapterIdx - 1, 'draft')
  if (!prior) return ''
  return [
    prior.summary ? `上一章（第 ${chapterIdx - 1} 章）发生了什么：${prior.summary}` : '',
    prior.endsWith ? `上一章结束时的状态：${prior.endsWith}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

export const generateChapterTool = tool(
  async ({ chapterIdx, previous, decisions }, config) => {
    const novelId = novelIdOf(config)
    const novel = novelOf(config)
    // 两个真 agent，各自带 responseFormat（zod schema）。
    // 不用裸模型 + 正则抠 JSON：结构化输出该由模型层保证，抠出来的那一版已经错了。
    //
    // 温度沿用原值（writer 0.7 / polisher 0.3）。maxTokens 必须显式给：
    // 一章正文 3000–4000 字 ≈ 6000+ token，加上 summary/endsWith 与 JSON 结构开销，
    // 不给上限时长章会中途截断 —— 而截断出来的正文读着还挺完整，只是结尾断在半句上。
    const writer = createWriterAgent(createModel(0.7, 300_000, false, 8192), flavorOf(config))
    const polisher = createPolisherAgent(createModel(0.3, 180_000, false, 8192), flavorOf(config))

    // 一次开库跑完整条链：plan → claim → 执笔 → draft → 润色 → final → 收尾。
    // 中间夹着两次模型调用，逐步开库关库既慢，也让「这一章的多个步骤」没有同一个事务视角。
    const result = await chapterApi.withChapterConnection(novelId, async (ctx) => {
      const chapter = ctx.getChapter(chapterIdx)
      if (!chapter) throw new Error(`找不到第 ${chapterIdx} 章章纲`)

      // 前情：调用方给了就用它；没给且不是第一章，就从库里取上一章的摘要与结尾状态。
      // 不兜这个底，第 2 章会被当成开篇写 —— 它读不到第 1 章末尾的钩子，衔接就断了，
      // 而且不会报错，只会写出一章自成体系却接不上的正文。
      const previousText = resolvePrevious(ctx, chapterIdx, previous)

      // 取材：只用本章出场的人、只用此刻合法的字段（secret/reveal/arcEnd 一律不给）。
      // 取材与渲染都在 my-app 后面 —— 「该给 writer 看什么」是业务判断，不该由调用方自觉传参。
      const brief = writingApi.getWritingBrief(ctx.database, novelId, chapter)
      const rendered = writingApi.renderBrief(brief)

      // 指纹只跟"这一章的输入"走：输入没变才允许复用已存的初稿
      const fingerprint = JSON.stringify({ chapter, previous: previousText, decisions, brief: rendered })

      const workflow = createChapterWorkflow({
        plan: async (input) => { ctx.planTask('chapter', String(input.chapterIdx), fingerprint) },
        claim: async (input) => {
          const task = ctx.claimTask('chapter', String(input.chapterIdx), fingerprint)
          return { action: task.action, taskId: task.taskId }
        },
        write: async (): Promise<ChapterDraft> => {
          const value = await writer.invoke({
            messages: [{
              role: 'user',
              content: buildWriterPrompt({
                world: rendered.world,
                cast: rendered.cast,
                places: rendered.place,
                style: novel.style || '无特别文风要求，按世界观基调走。',
                previous: previousText || '这是开篇，没有前情。',
                chapter: rendered.chapter,
                decisions: decisions?.trim() || '无',
              }),
            }],
          })
          // structuredResponse 是 zod schema 校验过的返回值 —— 比从文本里抠 JSON 可靠
          const drafted = value.structuredResponse
          if (!drafted?.text?.trim()) throw new Error('执笔 Agent 返回空正文')
          return { text: drafted.text, summary: drafted.summary ?? '', endsWith: drafted.endsWith ?? '' }
        },
        loadDraft: async () => {
          const draft = ctx.getText(chapterIdx, 'draft')
          if (!draft) throw new Error(`第 ${chapterIdx} 章没有可复用的初稿`)
          return { text: draft.text, summary: draft.summary, endsWith: draft.endsWith }
        },
        polish: async (input): Promise<ChapterPolish> => {
          const base = buildPolisherPrompt({
            terms: brief.terms || '（这本书还没有专名表）',
            forbidden: brief.forbidden || '（无特别禁令）',
            style: novel.style || '按世界观基调走。',
            text: input.draft.text,
          })
          const value = await polisher.invoke({
            messages: [{ role: 'user', content: input.polishRetry === true ? `${base}\n\n${RETRY_NOTE}` : base }],
          })
          const polished = value.structuredResponse
          if (!polished?.text?.trim()) throw new Error('润色 Agent 返回空正文')
          const changes = Array.isArray(polished.changes) ? polished.changes : []
          // 空转条目不是改动：before 与 after 一样的那种从审计清单里去掉。
          // 留着它们等于替模型把「我改了」这句话记进档案，而它其实一个字都没动。
          const applied = changes.filter((change) => change.before !== change.after)
          return { text: polished.text, report: { changes: applied, droppedNoop: changes.length - applied.length } }
        },
        // 终稿的记忆由 ctx.saveText 按 stage 决定要不要发（只有 final 记）
        save: async (input) => {
          ctx.saveText(input.chapterIdx, { stage: input.stage, text: input.text, summary: input.summary, endsWith: input.endsWith, polishReport: input.polishReport })
        },
        finish: async (input) => { ctx.finishTask(input.taskId) },
        fail: async (input) => { if (input.taskId !== undefined) ctx.failTask(input.taskId, input.error) },
      })

      return workflow({ novelId, chapterIdx, previous, decisions })
    })

    return JSON.stringify(result, null, 2)
  },
  {
    name: 'generate_chapter',
    description: '中心 Agent 的单次章节编排入口：直接读取本小说 SQLite，调用执笔模型和润色模型，保存 draft/final，失败收口并自动写入记忆。前端不参与中间步骤。',
    schema: z.object({ chapterIdx: z.number().int().positive(), previous: z.string().optional(), decisions: z.string().optional() }),
  },
)

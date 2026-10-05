import { tool } from 'langchain'
import type { RunnableConfig } from '@langchain/core/runnables'
import * as z from 'zod'
import { createModel } from '../../create_model'
import { rememberChapterText } from '../../storage/novelEffects'
import { openCatalogDatabase, openNovelDatabase } from '../../storage/novelDatabase'
import { createChapterRuntime } from '../chapterRuntime'
import { createChapterWorkflow, type ChapterDraft, type ChapterPolish } from '../chapterWorkflow'

const novelIdOf = (config?: RunnableConfig): number => {
  const id = (config?.configurable as Record<string, unknown> | undefined)?.novelId
  if (typeof id !== 'number' || !Number.isInteger(id)) throw new Error('章节生成缺少 configurable.novelId')
  return id
}

const modelText = (response: unknown): string => {
  if (typeof response === 'string') return response
  if (response && typeof response === 'object' && 'content' in response) return String((response as { content: unknown }).content)
  return String(response ?? '')
}

const jsonResponse = (response: unknown): Record<string, unknown> => {
  const text = modelText(response).replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim()
  const start = text.indexOf('{'); const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('模型没有返回 JSON 对象')
  return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>
}

const writerPrompt = (novel: { title: string; genre: string; style: string }, chapter: ReturnType<ReturnType<typeof createChapterRuntime>['getChapter']>, previous: string, decisions: string, context: string): string => `你是墨灵的执笔 Agent，只写一章中文小说正文。
输出严格 JSON：{"text":"正文纯文本","summary":"本章发生了什么","endsWith":"结尾状态"}，不要 Markdown，不要解释。
小说：《${novel.title}》；题材：${novel.genre}；文风：${novel.style}
世界与角色资料：${context}
前情：${previous || '这是开篇，没有前情。'}
角色裁决：${decisions || '无'}
本章章纲：${JSON.stringify(chapter)}
只写本章，不新增设定，不提前解决结尾钩子。`

const polisherPrompt = (novel: { title: string; style: string }, text: string, retry = false): string => `你是墨灵的润色 Agent。只改善表达、节奏和用词，不改变事实、情节、人物关系、专名和正文长度结构。
输出严格 JSON：{"text":"润色后的正文纯文本","changes":[{"kind":"用词","before":"原文","after":"改后"}]}

★ changes 必须是真的动过的地方：before 是原文、after 是你改成的样子，**两者不能相同**。
  没动过的地方不要列进来 —— 列一条 before === after 的，等于在报假账。
★ 你的活是让它读起来不像机器写的：删掉解释性的收束句和段尾点题、把「他觉得 / 他意识到」这类
  心理直述换成动作、拆散过于整齐的三段排比、去掉空泛的形容词堆叠。**必须真的动。**
★ 但绝不改变事实、数字、时间、专名、人物关系；也不要把正文写长或写短一大截。

小说：《${novel.title}》；文风：${novel.style}
正文：\n${text}${retry ? '\n\n★ 注意：你上一次一个字都没改，这不合格。这一遍必须真的动 —— 上面那几类机器味最重的地方，就是你要动的地方。' : ''}`

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
  runtime: ReturnType<typeof createChapterRuntime>,
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

const novelContext = (database: ReturnType<typeof openNovelDatabase>): string => {
  const world = database.query('SELECT name, premise, rules, terms, forbidden FROM worlds ORDER BY version DESC LIMIT 1').get()
  const characters = database.query('SELECT id, name, role, voice, want, need FROM characters ORDER BY id').all()
  return JSON.stringify({ world, characters })
}

export const generateChapterTool = tool(
  async ({ chapterIdx, previous, decisions }, config) => {
    const novelId = novelIdOf(config)
    const catalog = openCatalogDatabase()
    const novel = catalog.query('SELECT slug, title, genre, style FROM novels WHERE id = ?').get(novelId) as { slug: string; title: string; genre: string; style: string } | null
    catalog.close()
    if (!novel) throw new Error(`小说不存在：novelId=${novelId}`)
    const database = openNovelDatabase(novel.slug)
    const runtime = createChapterRuntime(database)
    const chapter = runtime.getChapter(chapterIdx)
    if (!chapter) { database.close(); throw new Error(`找不到第 ${chapterIdx} 章章纲`) }
    const context = novelContext(database)
    // 前情：调用方给了就用它；没给且不是第一章，就从库里取上一章的摘要与结尾状态。
    // 不兜这个底，第 2 章会被当成开篇写 —— 它读不到第 1 章末尾的钩子，衔接就断了，
    // 而且不会报错，只会写出一章自成体系却接不上的正文。
    const previousText = resolvePrevious(runtime, chapterIdx, previous)
    const writer = createModel(0.7, 300_000, false, 8192)
    const polisher = createModel(0.25, 180_000, false, 8192)
    const workflow = createChapterWorkflow({
      plan: async (input) => { runtime.planTask('chapter', String(input.chapterIdx), JSON.stringify({ chapter, previous: previousText, decisions })) },
      claim: async (input) => {
        const task = runtime.claimTask('chapter', String(input.chapterIdx), JSON.stringify({ chapter, previous: previousText, decisions }))
        return { action: task.action, taskId: task.taskId }
      },
      write: async (): Promise<ChapterDraft> => {
        const value = jsonResponse(await writer.invoke(writerPrompt(novel, chapter, previousText, decisions ?? '', context)))
        if (typeof value.text !== 'string' || !value.text.trim()) throw new Error('执笔 Agent 返回空正文')
        return { text: value.text, summary: typeof value.summary === 'string' ? value.summary : '', endsWith: typeof value.endsWith === 'string' ? value.endsWith : '' }
      },
      loadDraft: async () => {
        const draft = runtime.getText(chapterIdx, 'draft')
        if (!draft) throw new Error(`第 ${chapterIdx} 章没有可复用的初稿`)
        return { text: draft.text, summary: draft.summary, endsWith: draft.endsWith }
      },
      polish: async (input): Promise<ChapterPolish> => {
        const value = jsonResponse(await polisher.invoke(polisherPrompt(novel, input.draft.text, input.polishRetry === true)))
        if (typeof value.text !== 'string' || !value.text.trim()) throw new Error('润色 Agent 返回空正文')
        const changes = Array.isArray(value.changes) ? value.changes : []
        // 空转条目不是改动：before 与 after 一样的那种从审计清单里去掉。
        // 留着它们等于替模型把"我改了"这句话记进档案，而它其实一个字都没动。
        const applied = changes.filter((c) => {
          const item = (c ?? {}) as { before?: unknown; after?: unknown }
          return String(item.before ?? '') !== String(item.after ?? '')
        })
        return { text: value.text, report: { changes: applied, droppedNoop: changes.length - applied.length } }
      },
      save: async (input) => {
        runtime.saveText(input.chapterIdx, { stage: input.stage, text: input.text, summary: input.summary, endsWith: input.endsWith, polishReport: input.polishReport })
        // 记忆格式与 HTTP 手写终稿共用一份（见 storage/novelEffects 的 rememberChapterText）。
        // 只有 final 会真的记；draft 是过程稿。不 await —— 记忆挂了不该让这一章判失败。
        rememberChapterText(novelId, { chapterId: chapter.id, chapterIdx: input.chapterIdx, stage: input.stage, text: input.text, summary: input.summary, endsWith: input.endsWith })
      },
      finish: async (input) => { runtime.finishTask(input.taskId) },
      fail: async (input) => { if (input.taskId !== undefined) runtime.failTask(input.taskId, input.error) },
    })
    try { return JSON.stringify(await workflow({ novelId, chapterIdx, previous, decisions }), null, 2) } finally { database.close() }
  },
  {
    name: 'generate_chapter',
    description: '中心 Agent 的单次章节编排入口：直接读取本小说 SQLite，调用执笔模型和润色模型，保存 draft/final，失败收口并自动写入记忆。前端不参与中间步骤。',
    schema: z.object({ chapterIdx: z.number().int().positive(), previous: z.string().optional(), decisions: z.string().optional() }),
  },
)

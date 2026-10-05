import { tool } from 'langchain'
import type { RunnableConfig } from '@langchain/core/runnables'
import * as z from 'zod'
import { createModel } from '../../create_model'
import { captureNovelEvent } from '../../storage/autoCapture'
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

const polisherPrompt = (novel: { title: string; style: string }, text: string): string => `你是墨灵的润色 Agent。只改善表达、节奏和用词，不改变事实、情节、人物关系、专名和正文长度结构。
输出严格 JSON：{"text":"润色后的正文纯文本","changes":[{"kind":"用词","before":"原文","after":"改后"}]}
小说：《${novel.title}》；文风：${novel.style}
正文：\n${text}`

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
    const writer = createModel(0.7, 300_000, false, 8192)
    const polisher = createModel(0.25, 180_000, false, 8192)
    const workflow = createChapterWorkflow({
      plan: async (input) => { runtime.planTask('chapter', String(input.chapterIdx), JSON.stringify({ chapter, previous, decisions })) },
      claim: async (input) => {
        const task = runtime.claimTask('chapter', String(input.chapterIdx), JSON.stringify({ chapter, previous, decisions }))
        return { action: task.action, taskId: task.taskId }
      },
      write: async (): Promise<ChapterDraft> => {
        const value = jsonResponse(await writer.invoke(writerPrompt(novel, chapter, previous ?? '', decisions ?? '', context)))
        if (typeof value.text !== 'string' || !value.text.trim()) throw new Error('执笔 Agent 返回空正文')
        return { text: value.text, summary: typeof value.summary === 'string' ? value.summary : '', endsWith: typeof value.endsWith === 'string' ? value.endsWith : '' }
      },
      loadDraft: async () => {
        const draft = runtime.getText(chapterIdx, 'draft')
        if (!draft) throw new Error(`第 ${chapterIdx} 章没有可复用的初稿`)
        return { text: draft.text, summary: draft.summary, endsWith: draft.endsWith }
      },
      polish: async (input): Promise<ChapterPolish> => {
        const value = jsonResponse(await polisher.invoke(polisherPrompt(novel, input.draft.text)))
        if (typeof value.text !== 'string' || !value.text.trim()) throw new Error('润色 Agent 返回空正文')
        return { text: value.text, report: Array.isArray(value.changes) ? value.changes : [] }
      },
      save: async (input) => {
        runtime.saveText(input.chapterIdx, { stage: input.stage, text: input.text, summary: input.summary, endsWith: input.endsWith, polishReport: input.polishReport })
        if (input.stage === 'final') await captureNovelEvent(novelId, { title: `第${input.chapterIdx}章终稿`, content: `${input.summary ?? ''}\n${input.endsWith ?? ''}\n${input.text}`, sourceType: 'chapter_text', sourceId: `chapter:${chapter.id}:final`, chapterId: chapter.id })
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

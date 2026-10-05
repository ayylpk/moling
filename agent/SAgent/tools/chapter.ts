import { tool } from 'langchain'
import type { RunnableConfig } from '@langchain/core/runnables'
import * as z from 'zod'
import { createChapterWorkflow, type ChapterDraft, type ChapterPolish } from '../chapterWorkflow'
import { runChapterWriter, runProsePolisher } from './subagents'
import { planTasksTool, claimTaskTool, finishTaskTool, failTaskTool } from './tasks'
import { readChapterTextTool, saveChapterTextTool } from './database'

const jsonFromTool = (raw: unknown): Record<string, unknown> => {
  const text = typeof raw === 'string' ? raw : JSON.stringify(raw ?? '')
  const matches = [...text.matchAll(/\{[\s\S]*\}/g)]
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    try { return JSON.parse(matches[index]![0]) as Record<string, unknown> } catch { /* try the next JSON object */ }
  }
  return {}
}

const invoke = async (entry: unknown, input: unknown, config: RunnableConfig): Promise<unknown> => {
  const runnable = entry as { invoke?: (value: unknown, options?: RunnableConfig) => Promise<unknown> }
  if (!runnable.invoke) throw new Error('章节编排工具缺少 invoke 方法')
  return runnable.invoke(input, config)
}

const draftFrom = (raw: unknown): ChapterDraft => {
  const value = jsonFromTool(raw)
  const text = typeof value.text === 'string' ? value.text : ''
  if (!text.trim()) throw new Error('执笔 Agent 返回空正文')
  return { text, summary: typeof value.summary === 'string' ? value.summary : '', endsWith: typeof value.endsWith === 'string' ? value.endsWith : '' }
}

const polishFrom = (raw: unknown): ChapterPolish => {
  const value = jsonFromTool(raw)
  const text = typeof value.text === 'string' ? value.text : ''
  if (!text.trim()) throw new Error('润色 Agent 返回空正文')
  return { text, report: value.changes ?? [] }
}

const resultText = (raw: unknown): string => typeof raw === 'string' ? raw : JSON.stringify(raw ?? '')

export const generateChapterTool = tool(
  async ({ chapterIdx, previous, decisions }, config) => {
    if (!config) throw new Error('章节生成缺少运行配置')
    const novelId = Number((config.configurable as Record<string, unknown> | undefined)?.novelId)
    if (!Number.isInteger(novelId)) throw new Error('章节生成缺少 configurable.novelId')

    const workflow = createChapterWorkflow({
      plan: async (input) => { await invoke(planTasksTool, { stage: 'chapter', targetKeys: [String(input.chapterIdx)] }, config) },
      claim: async (input) => {
        const output = jsonFromTool(await invoke(claimTaskTool, { stage: 'chapter', targetKey: String(input.chapterIdx) }, config))
        const action = output.action === 'skip' ? 'skip' : 'run'
        const taskId = Number(output.taskId)
        if (!Number.isInteger(taskId)) throw new Error(`领取章节任务返回无效 taskId：${resultText(output)}`)
        return { action, taskId }
      },
      write: async (input) => draftFrom(await invoke(runChapterWriter, { chapterIdx: input.chapterIdx, previous: input.previous ?? '', decisions: input.decisions ?? '' }, config)),
      loadDraft: async (input) => draftFrom(await invoke(readChapterTextTool, { chapterIdx: input.chapterIdx, stage: 'draft' }, config)),
      polish: async (input) => polishFrom(await invoke(runProsePolisher, { text: input.draft.text }, config)),
      save: async (input) => {
        await invoke(saveChapterTextTool, {
          chapterIdx: input.chapterIdx,
          stage: input.stage,
          text: input.text,
          summary: input.summary ?? '',
          endsWith: input.endsWith ?? '',
          polishReport: input.polishReport,
        }, config)
      },
      fail: async (input) => { if (input.taskId !== undefined) await invoke(failTaskTool, { taskId: input.taskId, error: input.error }, config) },
      finish: async (input) => { await invoke(finishTaskTool, { taskId: input.taskId }, config) },
    })
    const result = await workflow({ novelId, chapterIdx, previous, decisions })
    return JSON.stringify(result, null, 2)
  },
  {
    name: 'generate_chapter',
    description: '由中心 Agent 统一编排一章：登记并领取任务，调用执笔 Agent，保存初稿，调用润色 Agent，保存终稿，最后收尾任务。用户和前端不参与中间步骤。',
    schema: z.object({
      chapterIdx: z.number().int().positive().describe('要生成的全篇章节号。'),
      previous: z.string().optional().describe('上一章结尾状态和未解决伏笔。'),
      decisions: z.string().optional().describe('本章已确定的角色裁决，没有则留空。'),
    }),
  },
)

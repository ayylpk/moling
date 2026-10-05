import { describe, expect, test } from 'bun:test'
import { createChapterWorkflow, type ChapterWorkflowDeps } from './chapterWorkflow'

const deps = (overrides: Partial<ChapterWorkflowDeps> = {}): ChapterWorkflowDeps => ({
  plan: async () => undefined,
  claim: async () => ({ action: 'run', taskId: 11 }),
  write: async () => ({ text: '初稿正文', summary: '本章发生了变化。', endsWith: '秘密尚未揭开。' }),
  polish: async () => ({ text: '终稿正文', report: ['调整节奏'] }),
  save: async () => undefined,
  ...overrides,
})

describe('center agent chapter workflow', () => {
  test('orchestrates plan, claim, writer, polisher, final save, and returns a trace', async () => {
    const calls: string[] = []
    const result = await createChapterWorkflow(deps({
      plan: async (input) => { calls.push(`plan:${input.chapterIdx}`) },
      claim: async (input) => { calls.push(`claim:${input.stage}`); return { action: 'run', taskId: 11 } },
      write: async () => { calls.push('write'); return { text: '初稿正文', summary: '本章发生了变化。', endsWith: '秘密尚未揭开。' } },
      polish: async () => { calls.push('polish'); return { text: '终稿正文', report: ['调整节奏'] } },
      save: async (input) => { calls.push(`save:${input.stage}`) },
    }))({ novelId: 7, chapterIdx: 3, previous: '上一章结尾', decisions: '无' })

    expect(calls).toEqual(['plan:3', 'claim:chapter', 'write', 'save:draft', 'polish', 'save:final'])
    expect(result).toMatchObject({ chapterIdx: 3, taskId: 11, status: 'done', finalText: '终稿正文' })
    expect(result.steps.map((step) => step.name)).toEqual(['plan', 'claim', 'write', 'save-draft', 'polish', 'save-final'])
  })

  test('reuses an existing draft when the chapter task is skipped', async () => {
    const calls: string[] = []
    const result = await createChapterWorkflow(deps({
      claim: async () => ({ action: 'skip', taskId: 12 }),
      loadDraft: async () => { calls.push('load-draft'); return { text: '已有初稿', summary: '已有摘要', endsWith: '已有结尾' } },
      polish: async () => { calls.push('polish'); return { text: '已有终稿', report: [] } },
      save: async (input) => { calls.push(`save:${input.stage}`) },
    }))({ novelId: 7, chapterIdx: 3 })

    expect(calls).toEqual(['load-draft', 'polish', 'save:final'])
    expect(result).toMatchObject({ status: 'done', taskId: 12, finalText: '已有终稿' })
  })

  test('marks the workflow failed and does not pretend final text exists', async () => {
    const result = await createChapterWorkflow(deps({ write: async () => { throw new Error('writer unavailable') } }))({ novelId: 7, chapterIdx: 3 })

    expect(result.status).toBe('failed')
    expect(result.error).toContain('writer unavailable')
    expect(result.finalText).toBeUndefined()
  })
})

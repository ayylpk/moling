import { describe, expect, test } from 'bun:test'
import { createChapterWorkflow, type ChapterWorkflowDeps, type ChapterWorkflowInput } from './chapterWorkflow'
import { SAGENT_SKILL } from './skill'

const deps = (overrides: Partial<ChapterWorkflowDeps> = {}): ChapterWorkflowDeps => ({
  plan: async () => undefined,
  claim: async () => ({ action: 'run', taskId: 11 }),
  write: async () => ({ text: '初稿正文', summary: '本章发生了变化。', endsWith: '秘密尚未揭开。' }),
  polish: async () => ({ text: '终稿正文', report: ['调整节奏'] }),
  save: async () => undefined,
  finish: async () => undefined,
  ...overrides,
})

describe('center agent chapter workflow', () => {
  test('center agent skill routes chapter prose through generate_chapter alone', () => {
    expect(SAGENT_SKILL).toContain('generate_chapter')
    // plan / claim / finish 是 generate_chapter 的内部实现，不许再作为手工步骤写回提示词。
    // 这条断言是**反面**的：早先它逐个检查 run_chapter_writer / save_chapter_text /
    // run_prose_polisher 等旧工具名的先后顺序 —— 那些工具在「章节只走 generate_chapter
    // 一次调用」之后就不存在了，断言随之失效（而没人回来更新它）。
    for (const gone of [
      'plan_tasks',
      'claim_task',
      'run_chapter_writer',
      'save_chapter_text',
      'run_prose_polisher',
      'finish_task',
      'fail_task',
    ]) {
      expect(SAGENT_SKILL).not.toContain(gone)
    }
    expect(SAGENT_SKILL).toContain('不要手工登记')
  })

  test('orchestrates plan, claim, writer, polisher, final save, and returns a trace', async () => {
    const calls: string[] = []
    const result = await createChapterWorkflow(deps({
      plan: async (input) => { calls.push(`plan:${input.chapterIdx}`) },
      claim: async (input) => { calls.push(`claim:${input.stage}`); return { action: 'run', taskId: 11 } },
      write: async () => { calls.push('write'); return { text: '初稿正文', summary: '本章发生了变化。', endsWith: '秘密尚未揭开。' } },
      polish: async () => { calls.push('polish'); return { text: '终稿正文', report: ['调整节奏'] } },
      save: async (input) => { calls.push(`save:${input.stage}`) },
      finish: async () => { calls.push('finish') },
    }))({ novelId: 7, chapterIdx: 3, previous: '上一章结尾', decisions: '无' })

    expect(calls).toEqual(['plan:3', 'claim:chapter', 'write', 'save:draft', 'polish', 'save:final', 'finish'])
    expect(result).toMatchObject({ chapterIdx: 3, taskId: 11, status: 'done', finalText: '终稿正文' })
    expect(result.steps.map((step) => step.name)).toEqual(['plan', 'claim', 'write', 'save-draft', 'polish', 'save-final', 'finish'])
  })

  test('reuses an existing draft when the chapter task is skipped', async () => {
    const calls: string[] = []
    const result = await createChapterWorkflow(deps({
      claim: async () => ({ action: 'skip', taskId: 12 }),
      loadDraft: async () => { calls.push('load-draft'); return { text: '已有初稿', summary: '已有摘要', endsWith: '已有结尾' } },
      polish: async () => { calls.push('polish'); return { text: '已有终稿', report: [] } },
      save: async (input) => { calls.push(`save:${input.stage}`) },
      finish: async () => { calls.push('finish') },
    }))({ novelId: 7, chapterIdx: 3 })

    expect(calls).toEqual(['load-draft', 'polish', 'save:final', 'finish'])
    expect(result).toMatchObject({ status: 'done', taskId: 12, finalText: '已有终稿' })
  })

  test('marks the workflow failed and does not pretend final text exists', async () => {
    const result = await createChapterWorkflow(deps({ write: async () => { throw new Error('writer unavailable') } }))({ novelId: 7, chapterIdx: 3 })

    expect(result.status).toBe('failed')
    expect(result.error).toContain('writer unavailable')
    expect(result.finalText).toBeUndefined()
  })
})

/**
 * 这一组测的是「润色空转」这条兜底。
 *
 * 背景：规则原本只写在提示词里（Polisher skill 第 11 条「changes 里有 before 与 after
 * 完全相同的条目 → 不合格」），**没有任何代码检查它**。e2e 实测就撞上了：
 * 模型返回 12 条 changes，每条 before === after，正文与初稿一字不差，
 * 整条链却一路 done —— 交付了一份没润过的稿子，还不报错。
 *
 * 所以这里钉住三件事：真的改了要放行；两次都没改要判失败；第一次没改要重试一次。
 */

const DRAFT = '她走进院子。天很黑。她感到一阵难过，意识到自己不该回来。'

const makeDeps = (polishOutputs: string[]) => {
  let polishCall = 0
  const polishCalls: Array<{ retry?: boolean }> = []
  const saves: Array<{ stage: string; text: string; polishReport?: unknown }> = []
  const workflowDeps: ChapterWorkflowDeps = {
    plan: async () => undefined,
    claim: async () => ({ action: 'run', taskId: 7 }),
    write: async () => ({ text: DRAFT, summary: '初稿概要', endsWith: '她站在门口' }),
    polish: async (input) => {
      polishCalls.push({ retry: input.polishRetry })
      const text = polishOutputs[polishCall] ?? ''
      polishCall += 1
      return { text, report: [{ kind: '用词', before: '天很黑', after: '天黑得看不清路' }] }
    },
    save: async (input) => {
      saves.push({ stage: input.stage, text: input.text, polishReport: input.polishReport })
    },
    finish: async () => undefined,
  }
  return { workflowDeps, polishCalls, saves }
}

const chapterInput: ChapterWorkflowInput = { novelId: 1, chapterIdx: 4 }

describe('章节工作流 · 润色空转', () => {
  test('润色真的改动了正文 → done，终稿用润色后的文本', async () => {
    const changed = '她跨进院门。天黑得看不清路。她把那句话咽了回去，转身去关院门。'
    const { workflowDeps, polishCalls, saves } = makeDeps([changed])
    const result = await createChapterWorkflow(workflowDeps)(chapterInput)

    expect(result.status).toBe('done')
    expect(result.finalText).toBe(changed)
    expect(polishCalls).toHaveLength(1)
    expect(polishCalls[0]!.retry).toBeUndefined()
    expect(saves.map((s) => s.stage)).toEqual(['draft', 'final'])
    expect(saves[1]!.text).toBe(changed)
  })

  test('第一次空转 → 重试一次（带 retry 标记），第二次改了 → done', async () => {
    const changed = '她跨进院门。天黑得看不清路。她把那句话咽了回去。'
    const { workflowDeps, polishCalls, saves } = makeDeps([DRAFT, changed])
    const result = await createChapterWorkflow(workflowDeps)(chapterInput)

    expect(result.status).toBe('done')
    expect(polishCalls).toHaveLength(2)
    expect(polishCalls[0]!.retry).toBeUndefined()
    expect(polishCalls[1]!.retry).toBe(true)
    expect(saves[1]!.text).toBe(changed)
  })

  test('两次都空转 → failed，且**没有**把初稿当终稿存下来', async () => {
    const { workflowDeps, polishCalls, saves } = makeDeps([DRAFT, DRAFT])
    const result = await createChapterWorkflow(workflowDeps)(chapterInput)

    expect(result.status).toBe('failed')
    expect(result.error).toContain('润色空转')
    expect(polishCalls).toHaveLength(2)
    // 关键：只存了 draft。若这里出现 final，就是"把没润过的稿子当终稿交付"
    expect(saves.map((s) => s.stage)).toEqual(['draft'])
    expect(result.steps.some((s) => s.name === 'finish')).toBe(false)
  })

  test('只多了首尾空白不算改过（同样是空转）', async () => {
    const { workflowDeps, saves } = makeDeps([`\n\n  ${DRAFT}  \n`, `  ${DRAFT}`])
    const result = await createChapterWorkflow(workflowDeps)(chapterInput)

    expect(result.status).toBe('failed')
    expect(saves.map((s) => s.stage)).toEqual(['draft'])
  })

  test('复用已有初稿（claim=skip）时同样要过空转检查', async () => {
    const changed = '她跨进院门。天黑得看不清路。'
    let polishCall = 0
    const saves: string[] = []
    const result = await createChapterWorkflow({
      plan: async () => undefined,
      claim: async () => ({ action: 'skip', taskId: 9 }),
      write: async () => {
        throw new Error('claim=skip 时不该重新执笔')
      },
      loadDraft: async () => ({ text: DRAFT, summary: 's', endsWith: 'e' }),
      polish: async () => {
        polishCall += 1
        return { text: polishCall === 1 ? DRAFT : changed, report: [] }
      },
      save: async (i) => {
        saves.push(i.stage)
      },
      finish: async () => undefined,
    })(chapterInput)

    expect(result.status).toBe('done')
    expect(saves).toEqual(['final'])
    expect(result.finalText).toBe(changed)
  })
})

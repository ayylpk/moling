export type ChapterDraft = { text: string; summary?: string; endsWith?: string }
export type ChapterPolish = { text: string; report?: unknown }
export type ChapterWorkflowInput = { novelId: number; chapterIdx: number; previous?: string; decisions?: string }
export type ChapterSaveInput = ChapterDraft & { novelId: number; chapterIdx: number; stage: 'draft' | 'final'; polishReport?: unknown }
export type ChapterClaimInput = ChapterWorkflowInput & { stage: 'chapter'; targetKey: string }
export type ChapterWorkflowStep = { name: 'plan' | 'claim' | 'write' | 'save-draft' | 'polish' | 'save-final' | 'finish'; status: 'done' | 'skipped' }
export type ChapterWorkflowDeps = {
  plan(input: ChapterWorkflowInput): Promise<void>
  claim(input: ChapterClaimInput): Promise<{ action: 'run' | 'skip'; taskId: number }>
  write(input: ChapterWorkflowInput): Promise<ChapterDraft>
  loadDraft?(input: ChapterWorkflowInput): Promise<ChapterDraft>
  polish(input: ChapterWorkflowInput & { draft: ChapterDraft }): Promise<ChapterPolish>
  save(input: ChapterSaveInput): Promise<void>
  finish(input: { novelId: number; chapterIdx: number; taskId: number }): Promise<void>
  fail?(input: ChapterWorkflowInput & { taskId?: number; error: string }): Promise<void>
}
export type ChapterWorkflowResult = {
  novelId: number
  chapterIdx: number
  taskId?: number
  status: 'done' | 'failed'
  finalText?: string
  error?: string
  steps: ChapterWorkflowStep[]
}

export const createChapterWorkflow = (deps: ChapterWorkflowDeps) => async (input: ChapterWorkflowInput): Promise<ChapterWorkflowResult> => {
  const steps: ChapterWorkflowStep[] = []
  let taskId: number | undefined
  try {
    await deps.plan(input)
    steps.push({ name: 'plan', status: 'done' })

    const claim = await deps.claim({ ...input, stage: 'chapter', targetKey: String(input.chapterIdx) })
    taskId = claim.taskId
    steps.push({ name: 'claim', status: claim.action === 'skip' ? 'skipped' : 'done' })

    const draft = claim.action === 'skip'
      ? await requireDraft(deps.loadDraft, input)
      : await deps.write(input)
    steps.push({ name: claim.action === 'skip' ? 'write' : 'write', status: claim.action === 'skip' ? 'skipped' : 'done' })

    if (claim.action !== 'skip') {
      await deps.save({ ...draft, ...input, stage: 'draft' })
      steps.push({ name: 'save-draft', status: 'done' })
    }

    const polished = await deps.polish({ ...input, draft })
    steps.push({ name: 'polish', status: 'done' })
    await deps.save({ ...draft, ...polished, ...input, stage: 'final', polishReport: polished.report })
    steps.push({ name: 'save-final', status: 'done' })
    if (taskId === undefined) throw new Error('章节任务缺少 taskId，无法收尾')
    await deps.finish({ novelId: input.novelId, chapterIdx: input.chapterIdx, taskId })
    steps.push({ name: 'finish', status: 'done' })
    return { ...input, taskId, status: 'done', finalText: polished.text, steps }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (deps.fail) await deps.fail({ ...input, taskId, error: message })
    return { ...input, taskId, status: 'failed', error: message, steps }
  }
}

const requireDraft = async (loadDraft: ChapterWorkflowDeps['loadDraft'], input: ChapterWorkflowInput): Promise<ChapterDraft> => {
  if (!loadDraft) throw new Error('任务已存在但没有提供初稿读取器')
  const draft = await loadDraft(input)
  if (!draft.text.trim()) throw new Error('任务已存在但初稿为空')
  return draft
}

import { createChapterRuntime } from '../db/chapterDB'
import { createDraftRuntime, type Draft, type DraftStage } from '../db/draftDB'
import { createWorldRuntime } from '../db/worldDB'
import { withNovel } from './withNovel'
import { getChapter, withChapterConnection } from './chapterController'
import {
  adoptCastDraft,
  adoptProseDraft,
  adoptVolumeOutlineDraft,
  adoptWorldDraft,
  type ProseDraftContent,
  type VolumeOutlineDraftContent,
} from '../service/draftService'
import { generateOutlineDraftContent, generateWorldDraftContent } from '../service/draftGenerationService'
import { runProseGeneration, novelFlavorOf } from '../service/proseGeneration'

/**
 * 草案 controller —— 「生成 → 审核 → 采纳/放弃」动线的唯一出口。
 *
 * ── 这条动线解决什么 ──
 * 生成结果先以草案形态落库（drafts 表，绑定 novelId），作者在页面上看到"待审核草案"，
 * 点「采纳并保存」才写正式表；点「放弃草案」就只清草案。**没有采纳动作，正式表不会变。**
 *
 * ── 前置条件在这里挡，不在前端挡 ──
 * 没有世界观不能排卷纲、没有章纲不能生成正文 —— 这些判断是业务规则，
 * 写在后端：绕过按钮直接打接口也一样被挡，返回的错就是给人看的下一句指令。
 *
 * 所有生成动作**一次调用只产一个阶段**，HTTP 入口天然满足；中心 Agent 那条路
 * 由 SAgent 的 turnGate 中间件强制（见 agent/SAgent/turnGate.ts）。
 */

export const listDrafts = (novelId: number, stage?: DraftStage): Array<Draft & { parsed: unknown }> =>
  withNovel(novelId, (database) => {
    const runtime = createDraftRuntime(database)
    return runtime.list(stage).map((draft) => {
      let parsed: unknown = draft.content
      try { parsed = JSON.parse(draft.content) } catch { /* 存的不一定是 JSON，原样给 */ }
      return { ...draft, parsed }
    })
  })

/** 重生成 / 工具层存草案的统一入口。覆盖式：同一 (stage, targetKey) 只保留最新一份。 */
export const saveDraft = (novelId: number, stage: DraftStage, targetKey: string, content: unknown): Draft =>
  withNovel(novelId, (database) =>
    createDraftRuntime(database).put(stage, targetKey, typeof content === 'string' ? content : JSON.stringify(content)))

export const clearDraft = (novelId: number, stage: DraftStage, targetKey?: string): { cleared: number } =>
  withNovel(novelId, (database) => ({ cleared: createDraftRuntime(database).clear(stage, targetKey) }))

/* ==================== 采纳 ==================== */

export type AdoptStage = 'world' | 'cast' | 'volume_outline' | 'prose'

/**
 * 采纳一份待审核草案：写正式表（含记忆副作用）、清草案。
 * 没有草案时抛 TypeError —— "没有作者确认过的生成结果就写正式表"这条路被堵死。
 */
export const adoptDraft = (
  novelId: number,
  stage: AdoptStage,
  targetKey?: string,
): unknown =>
  withNovel(novelId, (database) => {
    switch (stage) {
      case 'world':
        return adoptWorldDraft(database, novelId)
      case 'cast':
        return adoptCastDraft(database, novelId, targetKey)
      case 'volume_outline':
        return adoptVolumeOutlineDraft(database, novelId)
      case 'prose':
        return adoptProseDraft(database, novelId, targetKey === undefined ? undefined : Number(targetKey))
      default: {
        const exhaustive: never = stage
        throw new TypeError(`不支持的采纳阶段：${String(exhaustive)}`)
      }
    }
  })

/* ==================== 生成 · 世界观草案 ==================== */

/** 生成世界观草案（不落正式表，覆盖旧草案）。一次调用 = 一个阶段。 */
export const generateWorldDraft = async (novelId: number, need: string, name?: string) => {
  if (!need?.trim()) throw new TypeError('need 不能为空：这本书要什么样的世界，至少要说一句')
  const content = await generateWorldDraftContent(novelId, need.trim(), name)
  const draft = saveDraft(novelId, 'world', '', content)
  return { stage: 'world' as const, targetKey: '', updatedAt: draft.updatedAt, content }
}

/* ==================== 生成 · 卷纲草案 ==================== */

export type VolumeOutlineDraftRequest = {
  range: string
  need: string
  previous?: string
  /** 卷元数据：不给就按第一卷 / 章号段推断补默认值（Architect 本身不产这些字段）。 */
  volumeNo?: number
  name?: string
  goal?: string
  fromState?: string
  toState?: string
}

/** 生成卷纲（含该段的逐章章纲）草案。**前置：世界观必须已落库。** */
export const generateVolumeOutlineDraft = async (novelId: number, input: VolumeOutlineDraftRequest) => {
  const range = input.range?.trim()
  if (!range) throw new TypeError('range 不能为空：本次只排哪些章，例如「第 1–10 章」')
  if (!input.need?.trim()) throw new TypeError('need 不能为空：这一卷要交付什么，至少要说一句')

  const outline = await generateOutlineDraftContent(novelId, { range, need: input.need.trim(), previous: input.previous })
  const content = withVolumeMeta(input, outline)
  const draft = saveDraft(novelId, 'volume_outline', `${content.volume.start_chapter}-${content.volume.end_chapter}`, content)
  return { stage: 'volume_outline' as const, targetKey: draft.targetKey, updatedAt: draft.updatedAt, content }
}

/** 给 Architect 的产出补上卷元数据（卷号 / 卷名 / 起止章），存进草案，采纳时直接可用。 */
const withVolumeMeta = (
  input: VolumeOutlineDraftRequest,
  outline: Awaited<ReturnType<typeof generateOutlineDraftContent>>,
): VolumeOutlineDraftContent => {
  const indexes = outline.chapters.map((chapter) => Number(chapter.index)).filter((value) => Number.isInteger(value) && value > 0)
  const startChapter = indexes.length ? Math.min(...indexes) : 1
  const endChapter = indexes.length ? Math.max(...indexes) : startChapter
  const no = input.volumeNo ?? 1
  return {
    range: input.range.trim(),
    need: input.need.trim(),
    volume: {
      no,
      name: input.name?.trim() || `第 ${no} 卷`,
      goal: input.goal?.trim() || input.need.trim(),
      from_state: input.fromState?.trim() ?? '',
      to_state: input.toState?.trim() ?? '',
      start_chapter: startChapter,
      end_chapter: endChapter,
    },
    direction: outline.direction,
    structure: outline.structure,
    pacing: outline.pacing,
    constraints: outline.constraints,
    chapters: outline.chapters,
  }
}

/* ==================== 生成 · 正文草案 ==================== */

/** 生成一章正文（止于待审核草案，不写终稿）。**前置：世界观与该章章纲必须已落库。** */
export const generateProseDraft = async (
  novelId: number,
  chapterIdx: number,
  input: { previous?: string; decisions?: string } = {},
) => {
  if (!Number.isInteger(chapterIdx) || chapterIdx <= 0) throw new TypeError('chapterIdx 必须是正整数（第几章）')

  // 前置条件在这里挡：绕过按钮直接打接口也一样被挡，报错就是下一句该做的事
  const missingWorld = withNovel(novelId, (database) => createWorldRuntime(database).current() === null)
  if (missingWorld) throw new TypeError('这本小说还没有世界观：先生成并采纳世界观，再排卷纲和正文')
  const chapter = getChapter(novelId, chapterIdx)
  if (!chapter) throw new TypeError(`没有第 ${chapterIdx} 章的章纲：先把这一卷的卷纲草案采纳落库，再来生成正文`)

  const novel = novelFlavorOf(novelId)
  const result = await withChapterConnection(novelId, (ctx) =>
    runProseGeneration(ctx, { novelId, chapterIdx, previous: input.previous, decisions: input.decisions, novel }),
  )
  if (result.status === 'failed') {
    // 生成失败不得伪装成功：错误原样上抛，HTTP 层会回 400/500，前端展示并给重试按钮
    throw new Error(result.error ?? '本章生成失败')
  }
  const draft = withNovel(novelId, (database) => createDraftRuntime(database).get('prose', String(chapterIdx)))
  const content = draft ? (JSON.parse(draft.content) as ProseDraftContent) : null
  return { stage: 'prose' as const, targetKey: String(chapterIdx), updatedAt: draft?.updatedAt, content, steps: result.steps }
}

/** 有没有某一章（前端按钮的前置判断用，也用于把 chapterIdx 校验挡在 controller）。 */
export const hasChapterOutline = (novelId: number, chapterIdx: number): boolean =>
  withNovel(novelId, (database) => createChapterRuntime(database).getChapter(chapterIdx) !== null)

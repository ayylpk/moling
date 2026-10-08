import type { Database } from 'bun:sqlite'

import {
  createChapterRuntime,
  type ChapterOutlineInput,
  type ChapterText,
} from '../db/chapterDB'
import { createDraftRuntime, type DraftStage } from '../db/draftDB'
import { createOutlineRuntime, type AnchorInput } from '../db/outlineDB'
import { createWorldRuntime, type World } from '../db/worldDB'
import {
  rememberChapterText,
  saveChapterOutlinesWithMemory,
  saveCharacterWithMemory,
  saveVolumeOutlineWithMemory,
  saveWorldWithMemory,
  type ChapterOutlineSaveReport,
} from './entityService'

/**
 * 草案业务层 —— 「采纳」这一步的全部副作用都绑在这里。
 *
 * ── 为什么采纳要在 service 而不是 controller / tool ──
 * 采纳不是"复制一份文本"：它要写正式表、发记忆、再清掉草案，**三件事要么全做要么不做**。
 * 拆到两个调用方各写一遍，迟早出现"库落了、草案没清"或"草案清了、记忆没进"的分叉。
 * 全部函数都拿 Database（与 entityService 同一风格），开库关库归 controller。
 *
 * ── 铁律 ──
 * 没有草案就不能采纳（抛 TypeError）—— 这是"没有用户确认过生成结果就不能写正式表"
 * 在程序层的表达：正式表只能从"生成过、摆在那等人拍板"的草案里进来。
 */

/** 卷纲草案里存的卷元数据（生成时由调用方/默认值补齐，Architect 本身不产这些）。 */
export type DraftVolumeMeta = {
  no: number
  name: string
  goal: string
  from_state: string
  to_state: string
  start_chapter: number
  end_chapter: number
}

/** 卷纲草案的完整内容形态（generate_outline / HTTP 生成接口共用）。 */
export type VolumeOutlineDraftContent = {
  range: string
  need: string
  volume: DraftVolumeMeta
  direction: { logline: string; theme: string; coreConflict: string; endingDirection: string }
  structure: {
    type: string
    acts?: unknown[]
    turningPoints?: unknown[]
    mainPlot: unknown
    subplots?: unknown[]
  }
  pacing?: unknown
  constraints?: unknown
  chapters: Array<Record<string, unknown>>
}

/** 正文草案的完整内容形态。 */
export type ProseDraftContent = {
  chapterIdx: number
  text: string
  summary?: string
  endsWith?: string
  polishReport?: unknown
}

const readDraft = <T>(database: Parameters<typeof createDraftRuntime>[0], stage: DraftStage, targetKey = ''): T => {
  const content = createDraftRuntime(database).getParsed(stage, targetKey)
  if (content === null) throw new TypeError('没有待审核的草案可采纳：先用生成动作产出草案，等作者确认后再保存。')
  return content as T
}

/** 按阶段取草案（不关心 targetKey）——采纳的是"这一阶段最新的一份待审核草案"。 */
const readAnyDraft = <T>(database: Parameters<typeof createDraftRuntime>[0], stage: DraftStage): T => {
  const drafts = createDraftRuntime(database)
  const list = drafts.list(stage)
  if (list.length === 0) throw new TypeError('没有待审核的草案可采纳：先用生成动作产出草案，等作者确认后再保存。')
  try { return JSON.parse(list[0]!.content) as T } catch { return list[0]!.content as never }
}

/* ==================== 采纳 · 世界观 ==================== */

/** 把世界观草案写进正式表（新版本 + 骨架物化 + 记忆），成功后清掉草案。 */
export const adoptWorldDraft = (database: Database, novelId: number): World => {
  const input = readAnyDraft<Record<string, unknown>>(database, 'world')
  const world = saveWorldWithMemory(database, novelId, input as never)
  createDraftRuntime(database).clear('world')
  return world
}

/* ==================== 采纳 · 卷纲（含章纲） ==================== */

/**
 * 把卷纲草案落进正式表：卷 + 锚点 + 卷纲 + 逐章章纲，成功后清掉草案。
 *
 * 章纲逐条兜错：某一条失败不影响其余（与 save_chapter_outline 同一约定），
 * 失败的报告原样返回 —— 但**草案照常清除**：卷纲本体已落库，重交章纲不需要重排卷。
 */
export const adoptVolumeOutlineDraft = (
  database: Database,
  novelId: number,
): {
  volumeId: number
  volumeNo: number
  anchorWritten: boolean
  anchorDrift: boolean
  outlineDrift: boolean
  chapterReport: ChapterOutlineSaveReport
} => {
  const draft = readAnyDraft<VolumeOutlineDraftContent>(database, 'volume_outline')
  const volume = draft.volume

  const { created, anchor, outline } = saveVolumeOutlineWithMemory(database, novelId, {
    volume: {
      no: Number(volume.no),
      name: String(volume.name ?? ''),
      goal: String(volume.goal ?? ''),
      fromState: String(volume.from_state ?? ''),
      toState: String(volume.to_state ?? ''),
      startChapter: Number(volume.start_chapter),
      endChapter: Number(volume.end_chapter),
    },
    anchor: {
      logline: String(draft.direction?.logline ?? ''),
      theme: String(draft.direction?.theme ?? ''),
      coreConflict: String(draft.direction?.coreConflict ?? ''),
      endingDirection: String(draft.direction?.endingDirection ?? ''),
      structureType: String(draft.structure?.type ?? 'custom'),
      mainPlot: draft.structure?.mainPlot,
      subplots: draft.structure?.subplots ?? [],
      lockedByVolume: Number(volume.no),
    } satisfies AnchorInput,
    outline: {
      structureType: String(draft.structure?.type ?? 'custom'),
      acts: (draft.structure?.acts ?? []) as never[],
      turningPoints: (draft.structure?.turningPoints ?? []) as never[],
      pacing: draft.pacing ?? {},
      constraints: draft.constraints ?? {},
    },
  })

  const chapters: ChapterOutlineInput[] = (draft.chapters ?? []).map((chapter) => ({
    index: Number(chapter.index),
    title: String(chapter.title ?? ''),
    goal: chapter.goal === undefined ? undefined : String(chapter.goal),
    conflict: chapter.conflict === undefined ? undefined : String(chapter.conflict),
    hook: chapter.hook === undefined ? undefined : String(chapter.hook),
    emotion: chapter.emotion === undefined ? undefined : String(chapter.emotion),
    summary: chapter.summary === undefined ? undefined : String(chapter.summary),
    place: chapter.place === undefined ? undefined : String(chapter.place),
    characters: Array.isArray(chapter.characters) ? (chapter.characters as string[]) : undefined,
    wordCountTarget: chapter.wordCountTarget === undefined ? undefined : Number(chapter.wordCountTarget),
  }))
  const chapterReport = saveChapterOutlinesWithMemory(database, novelId, Number(volume.no), chapters)

  createDraftRuntime(database).clear('volume_outline')
  return {
    volumeId: created.volume.id,
    volumeNo: Number(volume.no),
    anchorWritten: anchor.written,
    anchorDrift: anchor.drift,
    outlineDrift: outline.drift,
    chapterReport,
  }
}

/* ==================== 采纳 · 正文终稿 ==================== */

/**
 * 把正文草案写成终稿（chapter_texts.stage='final'），发记忆（L0 事件入库，
 * L1/L3 链路自动接手），成功后清掉草案。**不会碰已有终稿之外的东西。**
 */
export const adoptProseDraft = (
  database: Database,
  novelId: number,
  chapterIdx?: number,
): ChapterText => {
  const runtime = createChapterRuntime(database)
  const storedIdx = (() => {
    const list = createDraftRuntime(database).list('prose')
    if (list.length === 0) throw new TypeError('没有待审核的正文草案可采纳：先生成本章正文，等作者确认后再保存。')
    if (chapterIdx !== undefined) return chapterIdx
    if (list.length > 1) throw new TypeError('有多章的待审核正文草案，必须指明 chapterIdx（采纳哪一章）。')
    return Number(list[0]!.targetKey)
  })()

  const chapter = runtime.getChapter(storedIdx)
  if (!chapter) throw new TypeError(`没有第 ${storedIdx} 章的章纲，正文草案无法落库`)

  const content = readDraft<ProseDraftContent>(database, 'prose', String(storedIdx))
  const saved = runtime.saveText(storedIdx, {
    stage: 'final',
    text: String(content.text ?? ''),
    summary: content.summary === undefined ? undefined : String(content.summary),
    endsWith: content.endsWith === undefined ? undefined : String(content.endsWith),
    polishReport: content.polishReport,
  })
  rememberChapterText(novelId, {
    chapterId: chapter.id,
    chapterIdx: storedIdx,
    stage: 'final',
    text: String(content.text ?? ''),
    summary: content.summary === undefined ? undefined : String(content.summary),
    endsWith: content.endsWith === undefined ? undefined : String(content.endsWith),
  })
  createDraftRuntime(database).clear('prose', String(storedIdx))
  return saved
}

/* ==================== 采纳 · 角色卡（cast） ==================== */

/**
 * 把角色卡草案落库。content 是生成时存下的完整卡；同名卡已存在时
 * saveCharacterWithMemory 走更新路径（与 save_character 工具同一行为）。
 */
export const adoptCastDraft = (database: Database, novelId: number, targetKey?: string): unknown => {
  const drafts = createDraftRuntime(database)
  const key = targetKey ?? drafts.list('cast')[0]?.targetKey ?? ''
  const input = readDraft<Record<string, unknown>>(database, 'cast', key)

  // 采纳入口与工具层共用同一套 service：落库 + 回填 + 记忆绑在一起
  const saved = saveCharacterWithMemory(database, novelId, input as never)
  drafts.clear('cast', key)
  return saved
}

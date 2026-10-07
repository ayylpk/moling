import type { Database } from 'bun:sqlite'

import {
  createChapterRuntime,
  type ChapterCast,
  type ChapterOutline,
  type ChapterOutlineInput,
  type ChapterOutlinePatch,
  type ChapterStage,
  type ChapterText,
  type GenerationTask,
  type PendingDemand,
  type TextStage,
  type Volume,
  type VolumeInput,
} from '../db/chapterDB'
import { rememberChapterOutline, rememberChapterText, saveChapterOutlinesWithMemory, type ChapterOutlineSaveReport } from '../service/entityService'
import { listNovelsInCatalog, openNovelDatabase, slugOfNovel, type CatalogNovel } from '../db/connection'
import { withNovel } from './withNovel'
import { composeChapterTxt, type ComposedExport } from '../shared/chapterTxt'

/**
 * 卷章 controller —— 一个动作一次调用。
 *
 * ── 两种入口，为什么 ──
 * 大多数动作是"一步就完"的（建一条章纲、读一章），用下面的独立函数。
 *
 * 但 generate_chapter 不是：它要在这**一个连接**上连着走 plan → claim → 执笔 →
 * 存 draft → 润色 → 存 final → 收尾，中间还夹着两次模型调用。逐步开库关库既慢，
 * 也让"这一章的多个步骤"没有同一个事务视角。所以给它 withChapterConnection：
 * 一次开库、把一组操作交出去、全程不关，跑完再关。
 *
 * 两种入口底下是**同一批 db 方法**，不存在"两条路各写一遍逻辑"。
 */

/* ==================== 一步就完的动作 ==================== */

/** 落一批章纲（一条 = 单章重跑，一整卷 = 一次落完）。每条各自提交、各自兜错 */
export const saveChapterOutlines = (
  novelId: number,
  volumeNo: number,
  chapters: ChapterOutlineInput[],
): ChapterOutlineSaveReport => withNovel(novelId, (database) => saveChapterOutlinesWithMemory(database, novelId, volumeNo, chapters))

/** 建一卷。卷本身不单独发记忆 —— 记忆记的是"这一卷的卷纲"（见 outlineController.saveVolumeOutline） */
export const createVolume = (novelId: number, input: VolumeInput) =>
  withNovel(novelId, (database) => createChapterRuntime(database).createVolume(input))

/** 卷列表（不含 hasOutline —— 那个由 outlineController 加，因为它要读卷纲表） */
export const listVolumes = (novelId: number): Volume[] =>
  withNovel(novelId, (database) => createChapterRuntime(database).listVolumes())

export const getVolumeByNo = (novelId: number, no: number): Volume | null =>
  withNovel(novelId, (database) => createChapterRuntime(database).getVolumeByNo(no))

export const listChapters = (novelId: number, volumeId?: number): ChapterOutline[] =>
  withNovel(novelId, (database) => createChapterRuntime(database).listChapters(volumeId))

export const getChapter = (novelId: number, idx: number): ChapterOutline | null =>
  withNovel(novelId, (database) => createChapterRuntime(database).getChapter(idx))

export const getChapterCast = (novelId: number, chapterIdx: number): ChapterCast[] =>
  withNovel(novelId, (database) => createChapterRuntime(database).getCast(chapterIdx))

/** 待办：章纲里写了 NEW: 但还没兑现的角色/地点。need 就是派给子 agent 的输入 */
export const listPendingDemands = (novelId: number): PendingDemand[] =>
  withNovel(novelId, (database) => createChapterRuntime(database).pendingDemands())

export const getChapterText = (novelId: number, chapterIdx: number, stage: TextStage): ChapterText | null =>
  withNovel(novelId, (database) => createChapterRuntime(database).getText(chapterIdx, stage))

/** 章节索引（剧情页 / 书稿页的列表）：章纲字段 + textStage */
export const listChapterSummaries = (novelId: number) =>
  withNovel(novelId, (database) => createChapterRuntime(database).listChapterSummaries())

/**
 * 把若干章导出成一份 txt。**一章和一百章走的是同一条路** —— 传进来的就是一个 chapterId 列表。
 *
 * 取哪一版正文：**终稿优先，没有终稿才退初稿**；两个都没有则该章写明"尚无正文"。
 * 用了初稿的章节会被写进文件开头的说明块 —— 不写的话，拿到 txt 的人会以为通篇都是定稿。
 * 这条规则刻意**不做成参数**：一个"要初稿还是终稿"的开关，多数时候只是让人多点一下。
 *
 * 传进来的 id 里若有已经不存在的章（比如别处删过），**只导存在的那些**，
 * 一个都不存在才报错 —— 为了一个过期的 id 让整次导出失败没有道理。
 */
export const exportChapters = (
  novelId: number,
  novelTitle: string,
  chapterIds: number[],
): ComposedExport & { chapterCount: number; draftCount: number; emptyCount: number } =>
  withNovel(novelId, (database) => {
    const rows = createChapterRuntime(database).listTextsForExport(chapterIds)
    if (rows.length === 0) throw new TypeError('选中的章节都不在这本书里')

    // 空字符串与只有空白都算"没有正文" —— 否则会导出一个标题下面空一行的章
    const pick = (row: { finalText: string | null; draftText: string | null }) => {
      const final = row.finalText?.trim() ? row.finalText : null
      const draft = row.draftText?.trim() ? row.draftText : null
      return { text: final ?? draft, stage: (final ? 'final' : draft ? 'draft' : null) as 'final' | 'draft' | null }
    }

    const composed = composeChapterTxt({
      novelTitle,
      chapters: rows.map((row) => ({ idx: row.idx, title: row.title, ...pick(row) })),
    })

    return {
      ...composed,
      chapterCount: rows.length,
      draftCount: rows.filter((row) => pick(row).stage === 'draft').length,
      emptyCount: rows.filter((row) => pick(row).stage === null).length,
    }
  })

/** 改一条章纲。改完发记忆：不记的话，"改完这条章纲"在记忆里就不存在 */
export const updateChapter = (novelId: number, id: number, patch: ChapterOutlinePatch): ChapterOutline | null =>
  withNovel(novelId, (database) => {
    const updated = createChapterRuntime(database).updateChapter(id, patch)
    if (updated) rememberChapterOutline(novelId, updated, updated.volumeId)
    return updated
  })

/** 存正文。只有终稿值得进记忆（初稿是过程稿，记进去只给抽取添噪音） */
export const saveChapterText = (
  novelId: number,
  chapterIdx: number,
  input: { stage: TextStage; text: string; summary?: string; endsWith?: string; polishReport?: unknown },
): ChapterText =>
  withNovel(novelId, (database) => {
    const runtime = createChapterRuntime(database)
    const chapter = runtime.getChapter(chapterIdx)
    const saved = runtime.saveText(chapterIdx, input)
    if (chapter) {
      rememberChapterText(novelId, {
        chapterId: chapter.id,
        chapterIdx,
        stage: input.stage,
        text: input.text,
        summary: input.summary,
        endsWith: input.endsWith,
      })
    }
    return saved
  })

/**
 * 按 chapterId 找它属于哪本书。
 *
 * ── 为什么这里不能"挨本找，找到就用" ──
 * chapterId 是 **per-novel 库里的自增主键**，每本书都从 1 开始。
 * 书架上只要有两本书，就一定有两本都有 id=1 的章。所以"遍历目录库、命中第一本就返回"
 * 写正文时会**写到别人的书里**：一个PUT 静默覆盖了另一本书的终稿，
 * 两本书的作者都以为改的是自己那本。
 *
 * 所以：命中多于一本就**明确报错**，让调用方带上 novelId，而不是替它猜。
 * 带 novelId 时只开那一本——这也顺带把"多本书时遍历 N 个库"省掉了。
 */
export const withChapterById = <T>(
  chapterId: number,
  action: (database: Database, novelId: number) => T,
  novelId?: number,
): T | null => {
  if (novelId !== undefined) {
    // 指定了书就只认这一本；它没有这一章 = 找不到，不退回去搜别本
    const runtime = openNovelDatabase(slugOfNovel(novelId))
    try {
      if (!createChapterRuntime(runtime).getChapterById(chapterId)) return null
      return action(runtime, novelId)
    } finally {
      runtime.close()
    }
  }

  const hits: Array<{ novel: CatalogNovel; database: Database }> = []
  for (const novel of listNovelsInCatalog()) {
    const database = openNovelDatabase(novel.slug)
    if (createChapterRuntime(database).getChapterById(chapterId)) hits.push({ novel, database })
    else database.close()
  }
  if (hits.length === 0) return null
  if (hits.length > 1) {
    for (const hit of hits) hit.database.close()
    throw new TypeError(`chapter_id=${chapterId} 在 ${hits.length} 本书里都存在：请求必须带 novelId，服务器不猜是哪一本`)
  }
  const only = hits[0]!
  try {
    return action(only.database, only.novel.id)
  } finally {
    only.database.close()
  }
}

/**
 * 下面三个是 withChapterById 的固定用法各包一层。
 *
 * 它们存在是因为「chapterId 属于哪本书」这件事对调用方是噪音：正文接口只拿到
 * chapterId，不该让路由写一遍遍历目录、判存在、开库、关库。**找不到或归属不唯一
 * 都返回 null / 抛错**，由路由回 404 —— 不猜。
 */
export const getChapterTextById = (chapterId: number, stage: TextStage, novelId?: number): ChapterText | null =>
  withChapterById(chapterId, (database) => createChapterRuntime(database).getTextById(chapterId, stage), novelId)

export const saveChapterTextById = (
  chapterId: number,
  stage: TextStage,
  input: { text: string; summary?: string; endsWith?: string },
  novelId?: number,
): ChapterText | null =>
  withChapterById(chapterId, (database, novelId) => {
    const runtime = createChapterRuntime(database)
    const chapter = runtime.getChapterById(chapterId)
    const saved = runtime.saveTextById(chapterId, { stage, ...input })
    if (chapter) {
      rememberChapterText(novelId, {
        chapterId,
        chapterIdx: chapter.idx,
        stage,
        text: input.text,
        summary: input.summary,
        endsWith: input.endsWith,
      })
    }
    return saved
  }, novelId)

export const updateChapterById = (chapterId: number, patch: ChapterOutlinePatch, novelId?: number): ChapterOutline | null =>
  withChapterById(chapterId, (database, novelId) => {
    const updated = createChapterRuntime(database).updateChapter(chapterId, patch)
    if (updated) rememberChapterOutline(novelId, updated, updated.volumeId)
    return updated
  }, novelId)

/* ==================== 连续多步：一次开库，全程不关 ==================== */

export type ChapterContext = {
  /** 底层 db 句柄。需要 db 层有、但这里没包的动作时用它（别为了绕过这层去自己开库） */
  readonly database: Database
  readonly novelId: number
  planTask(stage: ChapterStage, targetKey: string, inputHash?: string): GenerationTask
  claimTask(stage: ChapterStage, targetKey: string, inputHash?: string): { action: 'run' | 'skip'; taskId: number; task: GenerationTask }
  finishTask(taskId: number, artifactPath?: string): GenerationTask
  failTask(taskId: number, error: string): GenerationTask
  getChapter(idx: number): ChapterOutline | null
  getChapterById(id: number): ChapterOutline | null
  listChapters(volumeId?: number): ChapterOutline[]
  getText(chapterIdx: number, stage: TextStage): ChapterText | null
  /** 存正文并按 stage 决定要不要发记忆（只有 final 记） */
  saveText(chapterIdx: number, input: { stage: TextStage; text: string; summary?: string; endsWith?: string; polishReport?: unknown }): ChapterText
  getCast(chapterIdx: number): ChapterCast[]
}

/**
 * 一次开库，把一组章操作交出去，跑完再关。
 *
 * action 可以是异步的（章节生成里要等两次模型调用）。**期间不要在 action 里
 * 再去调那些独立函数** —— 那样会开出第二个连接去写同一张表，
 * 事务视角就断了，而且 SQLite 会在第二个连接上等锁。
 */
export const withChapterConnection = async <T>(
  novelId: number,
  action: (context: ChapterContext) => Promise<T> | T,
): Promise<T> => {
  const database = openNovelDatabase(slugOfNovel(novelId))
  try {
    const runtime = createChapterRuntime(database)
    const context: ChapterContext = {
      database,
      novelId,
      planTask: (stage, targetKey, inputHash = '') => runtime.planTask(stage, targetKey, inputHash),
      claimTask: (stage, targetKey, inputHash = '') => runtime.claimTask(stage, targetKey, inputHash),
      finishTask: (taskId, artifactPath = '') => runtime.finishTask(taskId, artifactPath),
      failTask: (taskId, error) => runtime.failTask(taskId, error),
      getChapter: (idx) => runtime.getChapter(idx),
      getChapterById: (id) => runtime.getChapterById(id),
      listChapters: (volumeId) => runtime.listChapters(volumeId),
      getText: (chapterIdx, stage) => runtime.getText(chapterIdx, stage),
      saveText: (chapterIdx, input) => {
        const chapter = runtime.getChapter(chapterIdx)
        const saved = runtime.saveText(chapterIdx, input)
        if (chapter) {
          rememberChapterText(novelId, {
            chapterId: chapter.id,
            chapterIdx,
            stage: input.stage,
            text: input.text,
            summary: input.summary,
            endsWith: input.endsWith,
          })
        }
        return saved
      },
      getCast: (chapterIdx) => runtime.getCast(chapterIdx),
    }
    return await action(context)
  } finally {
    database.close()
  }
}

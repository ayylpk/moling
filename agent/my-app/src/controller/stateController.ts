import type { Database } from 'bun:sqlite'

import { slugOfNovel } from '../db/connection'
import { phaseOf, type Phase } from '../shared/phase'
import { withNovel } from './withNovel'

/**
 * 状态 controller —— 「这本书现在到哪一步了」这件事的**唯一**出口。
 *
 * 为什么它是 controller 而不是 stateLite 自己查：
 * 中心 Agent 的状态快照（novelStateSync 每轮注入）和 /workflow 接口回答的是同一个问题，
 * 而这两条 SQL 写在两个地方的话，页面说"正在整理大纲"、Agent 说"还没世界观"，
 * 没人能一眼看出该改哪边。**判定规则 phaseOf 已经在 shared 里只有一份**，
 * 这里要守的是另一头：读到哪些事实、怎么交给上层。
 *
 * 返回的全是**事实**（哪几章写了、哪些行、什么阶段），不替上层决定怎么用。
 */
export type NovelStateSnapshot = {
  phase: Phase
  currentVolumeNo: number
  currentChapterIdx: number
  worldId: number | null
  worldVersion: number | null
  characterIds: number[]
  locationIds: number[]
  volumeIds: number[]
  draftedChapterIdxs: number[]
  finalizedChapterIdxs: number[]
  completedTaskKeys: string[]
}

const readFacts = (database: Database) => {
  const world = database.query('SELECT id, version FROM worlds ORDER BY version DESC LIMIT 1').get() as { id: number; version: number } | null
  const chapters = database.query('SELECT idx FROM chapters ORDER BY idx').all() as Array<{ idx: number }>
  const drafted = database
    .query("SELECT c.idx FROM chapters c JOIN chapter_texts t ON t.chapter_id = c.id WHERE t.stage = 'draft' ORDER BY c.idx")
    .all() as Array<{ idx: number }>
  const finalized = database
    .query("SELECT c.idx FROM chapters c JOIN chapter_texts t ON t.chapter_id = c.id WHERE t.stage = 'final' ORDER BY c.idx")
    .all() as Array<{ idx: number }>
  return { world, chapters, drafted, finalized }
}

export const getNovelStateSnapshot = (novelId: number): NovelStateSnapshot => {
  // 顺带确认这本书存在：slug 查不到会直接抛，调用方不必再自己判存在
  slugOfNovel(novelId)
  return withNovel(novelId, (database) => {
    const { world, chapters, drafted, finalized } = readFacts(database)
    const characters = database.query('SELECT id FROM characters ORDER BY id').all() as Array<{ id: number }>
    const locations = database.query('SELECT id FROM locations ORDER BY id').all() as Array<{ id: number }>
    const volumes = database.query('SELECT id FROM volumes ORDER BY no').all() as Array<{ id: number }>
    const tasks = database
      .query("SELECT stage, target_key FROM generation_tasks WHERE status = 'done'")
      .all() as Array<{ stage: string; target_key: string }>

    // 下一章该写哪一章：定稿优先。只有初稿就接着往下写，定稿了就从定稿那章的下一章开始
    const written = finalized.length > 0 ? finalized : drafted
    return {
      phase: phaseOf({
        hasWorld: world !== null,
        volumes: volumes.length,
        chapters: chapters.length,
        finalized: finalized.length,
      }),
      currentVolumeNo: volumes.length || 1,
      currentChapterIdx: (written.at(-1)?.idx ?? 0) + 1,
      worldId: world?.id ?? null,
      worldVersion: world?.version ?? null,
      characterIds: characters.map((item) => item.id),
      locationIds: locations.map((item) => item.id),
      volumeIds: volumes.map((item) => item.id),
      draftedChapterIdxs: drafted.map((item) => item.idx),
      finalizedChapterIdxs: finalized.map((item) => item.idx),
      completedTaskKeys: tasks.map((item) => `${item.stage}:${item.target_key}`),
    }
  })
}
/**
 * 章纲 + 出场角色 + 正文（chapters / chapter_cast / chapter_texts）的访问层。
 *
 * 三张表放一个文件，因为它们几乎总是一起读写：
 * 保存一卷大纲 = 写 chapters + 每章的 chapter_cast；写一章正文 = UPSERT chapter_texts。
 *
 * 最值得看的是 `selectPendingDemands`：它把「章纲里写了 NEW: 但还没兑现」
 * 的条目一条条列出来 —— 那就是中心 agent 的待办清单。
 */
import { db } from './createDB'
import type {
  ChapterEntity,
  ChapterCastEntity,
  ChapterTextEntity,
  ChapterBriefVO,
  PendingDemandVO,
  TextStage,
} from '../../../db/types'

/* ==================== 入参类型 ==================== */

export type NewChapterRow = Omit<ChapterEntity, 'id' | 'created_at' | 'updated_at'>
export type ChapterRowPatch = Partial<Omit<ChapterEntity, 'id' | 'novel_id' | 'created_at'>>

export type NewCastRow = Pick<ChapterCastEntity, 'novel_id' | 'chapter_id' | 'raw'> &
  Partial<Pick<ChapterCastEntity, 'character_id' | 'resolved_at'>>

export type NewChapterTextRow = Pick<ChapterTextEntity, 'novel_id' | 'chapter_id' | 'stage' | 'text'> &
  Partial<Pick<ChapterTextEntity, 'summary' | 'ends_with' | 'polish_report'>>

/* ==================== 字段白名单 ==================== */
const CHAPTER_TEXT_KEYS = [
  'title',
  'goal',
  'conflict',
  'hook',
  'emotion',
  'summary',
  'place_raw',
  'updated_at',
] as const
const CHAPTER_NUM_KEYS = ['idx', 'word_count_target'] as const

const TEXT_TEXT_KEYS = ['text', 'summary', 'ends_with', 'updated_at'] as const
const TEXT_JSON_KEYS = ['polish_report'] as const

/* ==================== 预编译语句 ==================== */

const stmtInsertChapter = db.query(`
  INSERT INTO chapters
    (novel_id, volume_id, idx, title, goal, conflict, hook, emotion, summary,
     place_raw, place_id, word_count_target)
  VALUES
    ($novel_id, $volume_id, $idx, $title, $goal, $conflict, $hook, $emotion, $summary,
     $place_raw, $place_id, $word_count_target)
`)
const stmtSelectChapter = db.query(`SELECT * FROM chapters WHERE id = ?`)
const stmtSelectChapterByIdx = db.query(`SELECT * FROM chapters WHERE novel_id = ? AND idx = ?`)
const stmtSelectChaptersByNovel = db.query(
  `SELECT * FROM chapters WHERE novel_id = ? ORDER BY idx`,
)
const stmtSelectChaptersByVolume = db.query(
  `SELECT * FROM chapters WHERE volume_id = ? ORDER BY idx`,
)
/**
 * 按「卷 + 章号」找一章。
 *
 * 保存大纲时用它，而不是按全局章号找：按 (novel, idx) 找的话，第二卷声明了
 * 第 3 章就会**把第一卷的第 3 章悄悄挪到自己名下** —— 那不叫报错，那叫把数据挪走了。
 * 按卷内找之后，跨卷撞号会走到 INSERT 并撞上 UNIQUE(novel_id, idx)，直接失败回滚。
 */
const stmtSelectByVolumeIdx = db.query(
  `SELECT * FROM chapters WHERE volume_id = ? AND idx = ?`,
)
const stmtDeleteChapter = db.query(`DELETE FROM chapters WHERE id = ?`)

const stmtInsertCast = db.query(`
  INSERT INTO chapter_cast (novel_id, chapter_id, raw, character_id, resolved_at)
  VALUES ($novel_id, $chapter_id, $raw, $character_id, $resolved_at)
`)
const stmtCastByChapter = db.query(`SELECT * FROM chapter_cast WHERE chapter_id = ? ORDER BY id`)
const stmtDeleteCastByChapter = db.query(`DELETE FROM chapter_cast WHERE chapter_id = ?`)

const stmtUpsertText = db.query(`
  INSERT INTO chapter_texts (novel_id, chapter_id, stage, text, summary, ends_with, polish_report)
  VALUES ($novel_id, $chapter_id, $stage, $text, $summary, $ends_with, $polish_report)
  ON CONFLICT(chapter_id, stage) DO UPDATE SET
    text          = excluded.text,
    summary       = excluded.summary,
    ends_with     = excluded.ends_with,
    polish_report = excluded.polish_report,
    updated_at    = datetime('now', 'localtime')
`)
const stmtSelectText = db.query(`SELECT * FROM chapter_texts WHERE chapter_id = ? AND stage = ?`)
const stmtSelectTextsByChapter = db.query(
  `SELECT * FROM chapter_texts WHERE chapter_id = ? ORDER BY stage`,
)
const stmtDeleteTextsByChapter = db.query(`DELETE FROM chapter_texts WHERE chapter_id = ?`)

/* ==================== 章纲 ==================== */

export const insertChapter = (row: NewChapterRow): number =>
  Number(
    stmtInsertChapter.run({
      $novel_id: row.novel_id,
      $volume_id: row.volume_id,
      $idx: row.idx,
      $title: row.title,
      $goal: row.goal,
      $conflict: row.conflict,
      $hook: row.hook,
      $emotion: row.emotion,
      $summary: row.summary,
      $place_raw: row.place_raw,
      $place_id: row.place_id,
      $word_count_target: row.word_count_target,
    }).lastInsertRowid,
  )

export const selectChapter = (id: number): ChapterEntity | null =>
  stmtSelectChapter.get(id) as ChapterEntity | null

export const selectChapterByIdx = (novelId: number, idx: number): ChapterEntity | null =>
  stmtSelectChapterByIdx.get(novelId, idx) as ChapterEntity | null

export const selectChaptersByNovel = (novelId: number): ChapterEntity[] =>
  stmtSelectChaptersByNovel.all(novelId) as ChapterEntity[]

export const selectChaptersByVolume = (volumeId: number): ChapterEntity[] =>
  stmtSelectChaptersByVolume.all(volumeId) as ChapterEntity[]

/** 卷内按章号找。保存大纲的 UPSERT 用这个 —— 见 stmtSelectByVolumeIdx 的说明 */
export const selectChapterByVolumeIdx = (
  volumeId: number,
  idx: number,
): ChapterEntity | null => stmtSelectByVolumeIdx.get(volumeId, idx) as ChapterEntity | null

/** 该小说最大章号，一章都没有时返回 0。下一卷的起始章号靠它算 */
export const selectMaxChapterIdx = (novelId: number): number =>
  (db.query(`SELECT coalesce(max(idx), 0) AS v FROM chapters WHERE novel_id = ?`).get(novelId) as {
    v: number
  }).v

/**
 * 精简列表：章号 / 标题 / 正文到哪一步 / 字数。
 *
 * textStage 和 wordCount 都是现算的，表里没有这两列 ——
 * 存副本就会和事实不同步（正文被重跑覆盖之后，那个副本就骗人了）。
 * wordCount 用 length(text)：SQLite 对 UTF-8 按字符数算，正好是中文的"字数"。
 */
export const selectChapterBriefs = (
  novelId: number,
  filter: { volume_id?: number; from?: number; to?: number } = {},
): ChapterBriefVO[] => {
  const conds = ['c.novel_id = $novel_id']
  const params: Record<string, string | number> = { $novel_id: novelId }
  if (filter.volume_id !== undefined) {
    conds.push('c.volume_id = $volume_id')
    params.$volume_id = filter.volume_id
  }
  if (filter.from !== undefined) {
    conds.push('c.idx >= $from')
    params.$from = filter.from
  }
  if (filter.to !== undefined) {
    conds.push('c.idx <= $to')
    params.$to = filter.to
  }
  return db
    .query(`
      SELECT c.id, c.idx, c.title, c.volume_id,
             coalesce(
               (SELECT t.stage FROM chapter_texts t WHERE t.chapter_id = c.id AND t.stage = 'final'),
               (SELECT t.stage FROM chapter_texts t WHERE t.chapter_id = c.id AND t.stage = 'draft'),
               'none'
             ) AS textStage,
             coalesce(
               (SELECT length(t.text) FROM chapter_texts t WHERE t.chapter_id = c.id
                ORDER BY CASE t.stage WHEN 'final' THEN 0 ELSE 1 END LIMIT 1),
               0
             ) AS wordCount
      FROM chapters c
      WHERE ${conds.join(' AND ')}
      ORDER BY c.idx
    `)
    .all(params) as ChapterBriefVO[]
}

export const updateChapterRow = (id: number, patch: ChapterRowPatch): number => {
  const sets: string[] = []
  const params: Record<string, string | number | null> = { $id: id }

  for (const key of CHAPTER_TEXT_KEYS) {
    const v = patch[key]
    if (v !== undefined) {
      sets.push(`${key} = $${key}`)
      params[`$${key}`] = v
    }
  }
  for (const key of CHAPTER_NUM_KEYS) {
    const v = patch[key]
    if (v !== undefined) {
      sets.push(`${key} = $${key}`)
      params[`$${key}`] = v
    }
  }
  // place_id 允许显式清空（改了 place_raw 之后重新解析）
  if ('place_id' in patch) {
    sets.push(`place_id = $place_id`)
    params.$place_id = patch.place_id ?? null
  }

  if (sets.length === 0) return 0
  return db.query(`UPDATE chapters SET ${sets.join(', ')} WHERE id = $id`).run(params).changes
}

export const deleteChapter = (id: number): number => stmtDeleteChapter.run(id).changes

/* ==================== 出场角色 ==================== */

export const insertCast = (row: NewCastRow): number =>
  Number(
    stmtInsertCast.run({
      $novel_id: row.novel_id,
      $chapter_id: row.chapter_id,
      $raw: row.raw,
      $character_id: row.character_id ?? null,
      $resolved_at: row.resolved_at ?? null,
    }).lastInsertRowid,
  )

export const selectCastByChapter = (chapterId: number): ChapterCastEntity[] =>
  stmtCastByChapter.all(chapterId) as ChapterCastEntity[]

export const deleteCastByChapter = (chapterId: number): number =>
  stmtDeleteCastByChapter.run(chapterId).changes

/** 角色建好之后，回头把同名未解析的出场记录补上。返回补了几条 */
export const resolvePendingCast = (
  novelId: number,
  raw: string,
  characterId: number,
  now: string,
): number =>
  db
    .query(`
      UPDATE chapter_cast
      SET character_id = $cid, resolved_at = $now
      WHERE novel_id = $novel_id AND character_id IS NULL AND raw = $raw
    `)
    .run({ $cid: characterId, $now: now, $novel_id: novelId, $raw: raw }).changes

/**
 * 待建清单：章纲里写了 `NEW:...` 但还没兑现的角色与地点。
 *
 * `need` 就是 NEW: 后面那段话 —— **正好是 Character / Location agent 的输入**。
 * 这张清单让"第 12 章需要一个能撞见仇人的地方"这种需求不会烂在 JSON 里。
 */
export const selectPendingDemands = (novelId: number): PendingDemandVO[] =>
  db
    .query(`
      SELECT 'character' AS kind, cs.chapter_id, c.idx AS chapter_idx,
             cs.raw AS raw, substr(cs.raw, 5) AS need
      FROM chapter_cast cs
      JOIN chapters c ON c.id = cs.chapter_id
      WHERE cs.novel_id = ? AND cs.character_id IS NULL AND upper(cs.raw) LIKE 'NEW:%'
      UNION ALL
      SELECT 'location', c.id, c.idx, c.place_raw, substr(c.place_raw, 5)
      FROM chapters c
      WHERE c.novel_id = ? AND c.place_id IS NULL AND upper(c.place_raw) LIKE 'NEW:%'
      ORDER BY chapter_idx, kind
    `)
    .all(novelId, novelId) as PendingDemandVO[]

/* ==================== 正文 ==================== */

/**
 * 写正文。**UPSERT**：同 (chapter, stage) 只留一行，重跑就覆盖。
 *
 * 不堆历史版本是有意的：库里只回答"现在是什么"。
 * 要看"改之前是什么"去磁盘 runs 目录 —— 那也是 artifact_path 的用处。
 */
export const upsertChapterText = (row: NewChapterTextRow): number => {
  stmtUpsertText.run({
    $novel_id: row.novel_id,
    $chapter_id: row.chapter_id,
    $stage: row.stage,
    $text: row.text,
    $summary: row.summary ?? '',
    $ends_with: row.ends_with ?? '',
    $polish_report: row.polish_report ?? '[]',
  })
  const saved = selectChapterText(row.chapter_id, row.stage)
  return saved?.id ?? 0
}

export const selectChapterText = (
  chapterId: number,
  stage: TextStage,
): ChapterTextEntity | null => stmtSelectText.get(chapterId, stage) as ChapterTextEntity | null

export const selectChapterTexts = (chapterId: number): ChapterTextEntity[] =>
  stmtSelectTextsByChapter.all(chapterId) as ChapterTextEntity[]

export const deleteChapterTexts = (chapterId: number): number =>
  stmtDeleteTextsByChapter.run(chapterId).changes

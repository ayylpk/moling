/**
 * 章纲 + 出场 + 正文的业务层。
 *
 * 三件事值得单独说明：
 *
 * 1. **章号是相对的，不是局部的。** `idx` 是全篇连续编号，靠 UNIQUE(novel_id, idx) 兜底。
 *    第二卷若从 1 重开会直接插入失败 —— 这是「编号全篇连续」那条约定的机器保证。
 *
 * 2. **重跑一卷大纲不会删掉已写的正文。** 章节按 idx UPSERT，不在新名单里的旧章
 *    只报出来（orphaned），不自动删 —— 删章节会级联带走它的正文和裁决记录，
 *    那是不可逆的。要删由调用方显式调 deleteChapter。
 *
 * 3. **chapter_cast 允许存在写不出 id 的行。** 章纲里写 `NEW:一个泄密的线人` 时
 *    那个人还不存在，这一行就是待办；等角色建好，characterService 会回头补上。
 */
import * as store from '../db/chapterDB'
import * as locationStore from '../db/locationDB'
import { now } from '../shared/time'
import { isDemand, normalizeRaw } from '../shared/demand'
import { resolveCharacterId } from './characterService'
import type {
  ChapterEntity,
  ChapterVO,
  ChapterBriefVO,
  ChapterQueryDTO,
  CreateChapterDTO,
  UpdateChapterDTO,
  SaveChapterTextDTO,
  ChapterTextVO,
  PendingDemandVO,
  VolumeEntity,
  TextStage,
} from '../../../db/types'

/* ==================== 转换 ==================== */

const toVO = (e: ChapterEntity): ChapterVO => {
  const cast = store.selectCastByChapter(e.id)
  const final = store.selectChapterText(e.id, 'final')
  const draft = store.selectChapterText(e.id, 'draft')
  const current = final ?? draft
  return {
    id: e.id,
    novel_id: e.novel_id,
    volume_id: e.volume_id,
    idx: e.idx,
    title: e.title,
    goal: e.goal,
    conflict: e.conflict,
    hook: e.hook,
    emotion: e.emotion,
    summary: e.summary,
    place_raw: e.place_raw,
    place_id: e.place_id,
    place_name: e.place_id === null ? null : (locationStore.selectLocation(e.place_id)?.name ?? null),
    characters: cast.map((c) => ({ raw: c.raw, character_id: c.character_id })),
    word_count_target: e.word_count_target,
    textStage: final ? 'final' : draft ? 'draft' : 'none',
    // 字数现算。存副本会在正文被重跑覆盖之后说谎
    wordCount: current ? current.text.length : 0,
    created_at: e.created_at,
    updated_at: e.updated_at,
  }
}

const textToVO = (t: { id: number; novel_id: number; chapter_id: number; stage: TextStage; text: string; summary: string; ends_with: string; polish_report: string; created_at: string; updated_at: string }): ChapterTextVO => ({
  id: t.id,
  novel_id: t.novel_id,
  chapter_id: t.chapter_id,
  stage: t.stage,
  text: t.text,
  summary: t.summary,
  ends_with: t.ends_with,
  polish_report: JSON.parse(t.polish_report) as unknown,
  wordCount: t.text.length,
  created_at: t.created_at,
  updated_at: t.updated_at,
})

/* ==================== 校验 ==================== */

const assertChapter = (c: CreateChapterDTO, where: string): void => {
  if (!c || typeof c !== 'object') throw new TypeError(`${where} 不是对象`)
  if (!Number.isInteger(c.idx) || c.idx < 1) throw new TypeError(`${where}: idx 必须是正整数`)
  for (const k of ['title', 'goal', 'conflict', 'hook'] as const) {
    if (typeof c[k] !== 'string' || !c[k].trim()) throw new TypeError(`${where}: ${k} 不能为空`)
  }
  if (!Array.isArray(c.characters)) throw new TypeError(`${where}: characters 必须是数组`)
}

/* ==================== 出场角色 ==================== */

/**
 * 重建一章的出场名单。
 *
 * 先删后插，不是增量更新：名单是"这一章有谁"的完整声明，
 * 增量合并反而会留下上一版多出来的人。
 */
const rebuildCast = (novelId: number, chapterId: number, characters: string[], ts: string): void => {
  store.deleteCastByChapter(chapterId)
  // 去重：UNIQUE(chapter_id, raw) 会在重复时报错，而重复本身是数据问题不是致命错
  const seen = new Set<string>()
  for (const raw of characters) {
    const norm = normalizeRaw(raw)
    if (!norm || seen.has(norm)) continue
    seen.add(norm)
    const cid = resolveCharacterId(novelId, norm)
    store.insertCast({
      novel_id: novelId,
      chapter_id: chapterId,
      raw: norm,
      character_id: cid,
      resolved_at: cid === null ? null : ts,
    })
  }
}

/* ==================== 章纲 ==================== */

/**
 * 按「卷内章号」UPSERT 一章，并重建它的出场名单与地点解析。
 *
 * 找章的范围限定在**本卷内**，这一点很关键：按全局章号找的话，第二卷声明了
 * 第 3 章就会把第一卷的第 3 章悄悄挪过来。按卷内找之后，跨卷撞号会走到 INSERT
 * 并撞上 UNIQUE(novel_id, idx) —— 直接失败，事务回滚，人能看到。
 *
 * **不开事务** —— 调用方（outlineService 保存整卷）会把它包在一个大事务里。
 */
export const upsertChapter = (
  volume: VolumeEntity,
  dto: CreateChapterDTO,
  ts: string,
): { id: number; created: boolean } => {
  const novelId = volume.novel_id
  const placeRaw = normalizeRaw(dto.place ?? '')
  const placeId =
    isDemand(placeRaw) || !placeRaw
      ? null
      : (locationStore.selectLocationByName(novelId, placeRaw)?.id ?? null)

  const existing = store.selectChapterByVolumeIdx(volume.id, dto.idx)
  let id: number
  let created: boolean

  if (existing) {
    store.updateChapterRow(existing.id, {
      title: dto.title.trim(),
      goal: dto.goal.trim(),
      conflict: dto.conflict.trim(),
      hook: dto.hook.trim(),
      emotion: (dto.emotion ?? '').trim(),
      summary: (dto.summary ?? '').trim(),
      place_raw: placeRaw,
      place_id: placeId,
      word_count_target: dto.word_count_target ?? existing.word_count_target,
      updated_at: ts,
    })
    id = existing.id
    created = false
  } else {
    try {
      id = store.insertChapter({
        novel_id: novelId,
        volume_id: volume.id,
        idx: dto.idx,
        title: dto.title.trim(),
        goal: dto.goal.trim(),
        conflict: dto.conflict.trim(),
        hook: dto.hook.trim(),
        emotion: (dto.emotion ?? '').trim(),
        summary: (dto.summary ?? '').trim(),
        place_raw: placeRaw,
        place_id: placeId,
        word_count_target: dto.word_count_target ?? 3000,
      })
    } catch (e) {
      // 全篇章号唯一。撞了说明这一章已经属于**别的卷**了
      if (e instanceof Error && e.message.includes('UNIQUE constraint failed: chapters')) {
        throw new TypeError(
          `第 ${dto.idx} 章已经存在于另一卷里。章号全篇唯一、不重开 —— ` +
            `第二卷要从 ${dto.idx} 之前那卷的末章号 + 1 开始`,
        )
      }
      throw e
    }
    created = true
  }

  rebuildCast(novelId, id, dto.characters, ts)
  return { id, created }
}

export const getChapter = (id: number): ChapterVO | null => {
  const e = store.selectChapter(id)
  return e ? toVO(e) : null
}

export const getChapterByIdx = (novelId: number, idx: number): ChapterVO | null => {
  const e = store.selectChapterByIdx(novelId, idx)
  return e ? toVO(e) : null
}

export const listChapters = (novelId: number, query: ChapterQueryDTO = {}): ChapterBriefVO[] => {
  const briefs = store.selectChapterBriefs(novelId, {
    volume_id: query.volume_id,
    from: query.from,
    to: query.to,
  })
  // textStage 过滤放在内存里：单本小说的章节数是几十到几百，
  // 为这个组合再拼一套动态 SQL 不划算。
  return query.textStage === undefined
    ? briefs
    : briefs.filter((b) => b.textStage === query.textStage)
}

export const updateChapter = (id: number, dto: UpdateChapterDTO): ChapterVO | null => {
  const exist = store.selectChapter(id)
  if (!exist) return null

  const ts = now()
  const patch: Parameters<typeof store.updateChapterRow>[1] = {}
  if (dto.title !== undefined) patch.title = dto.title.trim()
  if (dto.goal !== undefined) patch.goal = dto.goal.trim()
  if (dto.conflict !== undefined) patch.conflict = dto.conflict.trim()
  if (dto.hook !== undefined) patch.hook = dto.hook.trim()
  if (dto.emotion !== undefined) patch.emotion = dto.emotion.trim()
  if (dto.summary !== undefined) patch.summary = dto.summary.trim()
  if (dto.word_count_target !== undefined) patch.word_count_target = dto.word_count_target
  if (dto.place !== undefined) {
    const placeRaw = normalizeRaw(dto.place)
    patch.place_raw = placeRaw
    patch.place_id = isDemand(placeRaw) || !placeRaw
      ? null
      : (locationStore.selectLocationByName(exist.novel_id, placeRaw)?.id ?? null)
  }
  patch.updated_at = ts

  store.updateChapterRow(id, patch)
  if (dto.characters !== undefined) rebuildCast(exist.novel_id, id, dto.characters, ts)
  return toVO(store.selectChapter(id)!)
}

/**
 * 删一章。**会级联带走它的正文和裁决记录**，不可逆。
 * 保存整卷大纲时不会走到这里（那边只 UPSERT），所以这个只能被人显式调。
 */
export const deleteChapter = (id: number): boolean => store.deleteChapter(id) > 0

/** 该小说最大章号。下一卷的起始章号 = 它 + 1 */
export const maxChapterIdx = (novelId: number): number => store.selectMaxChapterIdx(novelId)

/* ==================== 正文 ==================== */

export const saveChapterText = (chapterId: number, dto: SaveChapterTextDTO): ChapterTextVO => {
  const chapter = store.selectChapter(chapterId)
  if (!chapter) throw new TypeError(`chapterId=${chapterId} 不存在`)
  if (dto.stage !== 'draft' && dto.stage !== 'final') {
    throw new TypeError('stage 只能是 draft 或 final')
  }
  if (typeof dto.text !== 'string' || !dto.text.trim()) throw new TypeError('text 不能为空')

  store.upsertChapterText({
    novel_id: chapter.novel_id,
    chapter_id: chapterId,
    stage: dto.stage,
    text: dto.text,
    summary: dto.summary ?? '',
    ends_with: dto.ends_with ?? '',
    polish_report: dto.polish_report === undefined ? '[]' : JSON.stringify(dto.polish_report),
  })
  return textToVO(store.selectChapterText(chapterId, dto.stage)!)
}

export const getChapterText = (chapterId: number, stage: TextStage): ChapterTextVO | null => {
  const t = store.selectChapterText(chapterId, stage)
  return t ? textToVO(t) : null
}

export const listChapterTexts = (chapterId: number): ChapterTextVO[] =>
  store.selectChapterTexts(chapterId).map(textToVO)

/* ==================== 待办 ==================== */

/** 章纲里写了 NEW: 但还没兑现的角色与地点。need 就是下游 agent 的输入 */
export const listPendingDemands = (novelId: number): PendingDemandVO[] =>
  store.selectPendingDemands(novelId)

import type { Database } from 'bun:sqlite'

import { createChapterRuntime, type ChapterOutline, type ChapterOutlineInput, type VolumeInput } from '../SAgent/chapterRuntime'
import { createCharacterRuntime, type Character, type CharacterInput } from '../SAgent/characterRuntime'
import { createDecisionRuntime, type ActorDecision, type DecisionInput } from '../SAgent/decisionRuntime'
import { createLocationRuntime, type Location, type LocationInput } from '../SAgent/locationRuntime'
import { createOutlineRuntime, type AnchorInput, type VolumeOutlineInput } from '../SAgent/outlineRuntime'
import { createWorldRuntime, type World, type WorldInput } from '../SAgent/worldRuntime'

import { captureNovelEvent } from './autoCapture'
import type { L0Event } from './portraitPipeline'

/**
 * 落库的**副作用**：自动记忆，以及那些「建完这一条、回头补另一条」的回填。
 * 中心 Agent 的工具层和 HTTP 层（agent/storage/server.ts）**共用这一份**。
 *
 * ── 为什么必须共用 ──
 * 这两条路径原先各写一套：工具层落库后发记忆、还回填引用；HTTP 层只调 runtime 落库。
 * 于是同一件事，走 Agent 落库会进 L0→L1→L3 记忆链路，走 HTTP 落库不进 ——
 * 而且不报错，只是那本书的记忆里少了一截，事后没人查得出来。
 * 一个动作有两个副作用，迟早有一个是错的；错的那个还最安静。
 *
 * ── 分两层，是因为 HTTP 的粒度更碎 ──
 *   · `rememberXxx`  —— 「这个实体落库之后要记成什么」。格式**只在这里写一次**。
 *   · `saveXxxWithMemory` —— 给常用的整件事（落库 + 回填 + 记忆）打包，工具层直接用。
 * HTTP 有些路由落库的粒度更细（比如只写卷纲、不建卷），它们调 runtime 之后自己调
 * 对应的 `rememberXxx`，于是记忆格式仍然是同一份，不会有第二套。
 *
 * ── 记忆失败不许回滚业务 ──
 * 记忆链路里挂着 embedding 与模型调用。它挂了不该把刚提交的角色/大纲一起回滚
 * （那会让「存成功」变成一句谎话）。所以 rememberNovelEvent 不 await、不抛。
 */

/** 记忆是锦上添花，不是业务的一部分：出什么错都咽下去 */
export const rememberNovelEvent = (novelId: number, event: Omit<L0Event, 'novelId'>): void => {
  void captureNovelEvent(novelId, event).catch(() => undefined)
}

/* ==================== 每个实体「记成什么」 ==================== */
/* 下面这几个是记忆格式的唯一出处：工具层和 HTTP 层都从这里拿，不各写一套。 */

export const rememberWorld = (novelId: number, world: World): void => {
  rememberNovelEvent(novelId, {
    title: `世界观:${world.name}:v${world.version}`,
    content: JSON.stringify(world),
    sourceType: 'world',
    sourceId: `world:${world.id}`,
  })
}

export const rememberCharacter = (novelId: number, character: Character): void => {
  rememberNovelEvent(novelId, {
    title: `角色:${character.name}`,
    content: JSON.stringify(character),
    sourceType: 'character',
    sourceId: `character:${character.id}`,
    characterId: character.id,
  })
}

export const rememberLocation = (novelId: number, location: Location): void => {
  rememberNovelEvent(novelId, {
    title: `地点:${location.name}`,
    content: JSON.stringify(location),
    sourceType: 'location',
    sourceId: `location:${location.id}`,
  })
}

export const rememberChapterOutline = (novelId: number, chapter: ChapterOutline, volumeId: number): void => {
  rememberNovelEvent(novelId, {
    title: `第${chapter.idx}章章纲`,
    content: JSON.stringify(chapter),
    sourceType: 'chapter_outline',
    sourceId: `chapter:${chapter.id}:outline`,
    volumeId,
    chapterId: chapter.id,
  })
}

/**
 * 卷纲的记忆。`volumeName` 只是为了标题好认，不影响检索（检索靠 sourceId）。
 * 单独拆出来是因为 HTTP 的 POST /outline 会只写卷纲、不建卷。
 */
export const rememberVolumeOutline = (
  novelId: number,
  input: { volumeId: number; volumeName: string; volume: unknown; direction: unknown; structureType?: string; acts?: unknown[] },
): void => {
  rememberNovelEvent(novelId, {
    title: `卷纲:${input.volumeName}`,
    content: JSON.stringify({ volume: input.volume, direction: input.direction, structureType: input.structureType, acts: input.acts ?? [] }),
    sourceType: 'volume_outline',
    sourceId: `volume:${input.volumeId}`,
    volumeId: input.volumeId,
  })
}

export const rememberDecision = (novelId: number, chapterIdx: number, decision: ActorDecision): void => {
  rememberNovelEvent(novelId, {
    title: `第${chapterIdx}章裁决`,
    content: JSON.stringify(decision),
    sourceType: 'decision',
    sourceId: `decision:${decision.chapterId}:${decision.promptHash}`,
    chapterId: decision.chapterId,
    characterId: decision.characterId ?? undefined,
  })
}

/**
 * 正文的记忆。**只有终稿值得记** —— 初稿是过程稿，记进去只会给记忆链路添噪音。
 * 这条规矩两边一样：generate_chapter 落 final 时调它，HTTP 手写终稿时也调它。
 */
export const rememberChapterText = (
  novelId: number,
  input: { chapterId: number; chapterIdx: number; stage: string; text: string; summary?: string; endsWith?: string },
): void => {
  if (input.stage !== 'final') return
  rememberNovelEvent(novelId, {
    title: `第${input.chapterIdx}章终稿`,
    content: `${input.summary ?? ''}\n${input.endsWith ?? ''}\n${input.text}`,
    sourceType: 'chapter_text',
    sourceId: `chapter:${input.chapterId}:final`,
    chapterId: input.chapterId,
  })
}

/* ==================== 整件事打包（工具层直接用） ==================== */

/**
 * 落一版世界观。
 * 骨架物化（把 places 写进 locations）在 worldRuntime.create 里，所以这里不必再管 ——
 * 但记忆必须在这里发，否则 HTTP 落库的世界观不进记忆链路。
 */
export const saveWorldWithMemory = (database: Database, novelId: number, input: WorldInput): World => {
  const world = createWorldRuntime(database).create(input)
  rememberWorld(novelId, world)
  return world
}

/**
 * 落一张角色卡。
 * 回填：建卡之后回头把章纲里同名、还没解析的出场记录补上
 * （chapter_cast.character_id 落 NULL 的那些）。少了这一步，
 * 「章纲先写了林晚、卡后来才建」这条最常见的路径上，待办永远清不掉。
 */
export const saveCharacterWithMemory = (database: Database, novelId: number, input: CharacterInput) => {
  const runtime = createCharacterRuntime(database)
  const saved = runtime.create(input)
  const resolvedCast = saved.created ? createChapterRuntime(database).resolveCast(saved.character.name, saved.character.id) : 0
  rememberCharacter(novelId, saved.character)
  return { ...saved, resolvedCast }
}

/**
 * 落一张地点卡。
 * 回填：建好父地点之后，把之前挂在它名下、当时还解析不到的**子地点**补上。
 * 世界观只铺粗骨架，细粒度地点是剧情里长出来的 —— 「先有儿子后有爹」是常态，不是异常。
 */
export const saveLocationWithMemory = (database: Database, novelId: number, input: LocationInput) => {
  const runtime = createLocationRuntime(database)
  const saved = runtime.create(input)
  const resolvedChildren = saved.created ? runtime.resolvePendingChildren(saved.location.name, saved.location.id) : 0
  rememberLocation(novelId, saved.location)
  return { ...saved, resolvedChildren }
}

export type VolumeOutlineBundle = {
  /** 卷本体 */
  volume: VolumeInput
  /** 这一卷提交的全篇锚点（第一卷定稿，后续卷原样回填） */
  anchor: AnchorInput
  /** 卷纲：幕 / 转折点 / 节奏 / 约束（volumeId 与快照由这里补） */
  outline: Omit<VolumeOutlineInput, 'volumeId' | 'anchorSnapshot'>
}

/**
 * 落一卷：卷 + 全篇锚点 + 卷纲，然后记一条记忆。
 *
 * 顺序有意义，不能换：**先写锚点，再写卷纲** —— 卷纲要留「这一卷实际提交的锚点」快照，
 * 锚点先落定，第一卷的快照才和锚点一致，也才不会把自己人误报成漂移。
 */
export const saveVolumeOutlineWithMemory = (database: Database, novelId: number, bundle: VolumeOutlineBundle) => {
  const chapters = createChapterRuntime(database)
  const outlines = createOutlineRuntime(database)

  const created = chapters.createVolume(bundle.volume)
  const anchor = outlines.saveAnchor(bundle.anchor)
  const outline = outlines.saveVolumeOutline({
    ...bundle.outline,
    volumeId: created.volume.id,
    anchorSnapshot: bundle.anchor,
  })

  rememberVolumeOutline(novelId, {
    volumeId: created.volume.id,
    volumeName: bundle.volume.name,
    volume: bundle.volume,
    direction: bundle.anchor,
    structureType: bundle.outline.structureType,
    acts: bundle.outline.acts,
  })

  return { created, anchor, outline }
}

export type ChapterOutlineSaveReport = {
  volume: { id: number; no: number }
  saved: Array<{ idx: number; chapterId: number; created: boolean; place: string | null; cast: { total: number; resolved: number; unresolved: string[] } }>
  failed: Array<{ index: number; error: string }>
}

/**
 * 落一批章纲（一条 = 单章重跑，一整卷 = 一次落完），每条各自提交、各自兜错。
 *
 * 一条失败不该带走其余各条：它们已经落好了，回滚只会把好数据扔掉。
 * 失败的那条连原因一起返回，调用方据此单独补一条重跑。
 */
export const saveChapterOutlinesWithMemory = (
  database: Database,
  novelId: number,
  volumeNo: number,
  chapters: ChapterOutlineInput[],
): ChapterOutlineSaveReport => {
  const runtime = createChapterRuntime(database)
  const volume = runtime.getVolumeByNo(volumeNo)
  if (!volume) throw new TypeError(`第 ${volumeNo} 卷还没建档：先把卷落下来（save_volume_outline）`)

  const saved: ChapterOutlineSaveReport['saved'] = []
  const failed: ChapterOutlineSaveReport['failed'] = []

  for (const item of chapters) {
    try {
      const result = runtime.saveChapterOutline(volume.id, item)
      const unresolved = result.cast.filter((c) => c.characterId === null).map((c) => c.raw)

      saved.push({
        idx: result.chapter.idx,
        chapterId: result.chapter.id,
        created: result.created,
        place: result.chapter.placeRaw,
        cast: { total: result.cast.length, resolved: result.cast.length - unresolved.length, unresolved },
      })

      rememberChapterOutline(novelId, result.chapter, volume.id)
    } catch (error) {
      failed.push({ index: item.index, error: error instanceof Error ? error.message : String(error) })
    }
  }

  return { volume: { id: volume.id, no: volume.no }, saved, failed }
}

/**
 * 记一次裁决。
 * prompt_hash 相同就直接复用旧记录（reused=true）—— 重跑一章是常事，这一步省下的是真调用。
 * 复用时照样发记忆（记忆按 sourceId 去重，不会重复堆）。
 */
export const saveActorDecisionWithMemory = (database: Database, novelId: number, input: DecisionInput) => {
  const saved = createDecisionRuntime(database).save(input)
  rememberDecision(novelId, input.chapterIdx, saved.decision)
  return saved
}

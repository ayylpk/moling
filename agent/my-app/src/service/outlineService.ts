/**
 * 大纲业务层 —— 全项目里唯一一个「一次写入跨 5 张表」的操作。
 *
 * 保存一卷大纲要落：volumes / outline_volumes / chapters / chapter_cast / generation_tasks。
 * **必须包在一个事务里**，否则中途失败会留下一卷只有一半章节的库 —— 那种半成品
 * 比彻底失败难查得多：进度看着像跑完了，实际少了几章。
 *
 * 另外两件事也在这里定：
 *
 * 1. **锚点只由第一卷写，之后只读。** 后续卷即使传了不同的锚点，也不覆盖已有的那份，
 *    只把提交的那份存成 snapshot 并报出 drift。理由是"锚点漂移"是缺陷不是编辑，
 *    我们的活是把它**测出来**，不是替调用方把它改掉。
 *
 * 2. **编排状态只登记、不执行。** volume ready 时顺手把 `outline` 的 task 登记成 pending，
 *    这一层不跑 agent、不管 input_hash —— 那是中心 agent 的事。
 *    （hash 要等它把当时的真实输入算出来才知道，service 这里猜不得。）
 */
import * as volumeStore from '../db/volumeDB'
import * as outlineStore from '../db/outlineDB'
import * as chapterStore from '../db/chapterDB'
import * as taskStore from '../db/taskDB'
import { withTransaction } from '../db/createDB'
import { now } from '../shared/time'
import * as chapterService from './chapterService'
import * as volumeService from './volumeService'
import type {
  SaveVolumeOutlineDTO,
  CreateAnchorDTO,
  OutlineAnchorVO,
  OutlineVolumeVO,
  OutlineVolumeEntity,
  OutlineAnchorEntity,
  ChapterBriefVO,
  VolumeVO,
  AnchorSnapshot,
  Plotline,
  Act,
  TurningPoint,
  PacingPlan,
  OutlineConstraintsData,
} from '../../../db/types'

/* ==================== 规范化 ==================== */

/**
 * 递归按 key 排序再序列化。
 *
 * 为什么不能直接 JSON.stringify 比：两次生成里同一个对象的键顺序不一定一样，
 * 直接比会把"只是键序不同"报成漂移。报假警比不报还糟 —— 一旦有一次误报，
 * 这个检查就没人看了。
 */
const sortKeys = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(sortKeys)
  if (v && typeof v === 'object') {
    const obj = v as Record<string, unknown>
    return Object.fromEntries(Object.keys(obj).sort().map((k) => [k, sortKeys(obj[k])]))
  }
  return v
}

const parseMaybe = (v: unknown): unknown => (typeof v === 'string' ? JSON.parse(v) : v)

/**
 * 序列化前的规范化。
 *
 * 注意 parseMaybe 必须在**字段级**调用，不能只在最外层调一次 ——
 * 实体里 main_plot / subplots 是 JSON 字符串，而提交上来的是对象；
 * 只在最外层解析的话，字符串会被当成普通字符串参与比较，
 * 于是"库里的"和"提交的"永远不相等，**漂移检查会永远报 true**。
 * （这一条是被断言脚本抓出来的。）
 */
const canon = (v: unknown): string => JSON.stringify(sortKeys(v))

/**
 * 只取参与漂移比对的字段 —— novel_id / locked_at 那些跟"内容改没改"无关。
 *
 * 参数类型故意放松（main_plot / subplots 收 unknown，subplots 可缺省）：
 * 这个函数两边都要吃 —— 库里读出来的是 JSON 字符串，提交上来的是对象，
 * subplots 还可能整个没给。
 */
const anchorCore = (a: {
  logline: string
  theme: string
  core_conflict: string
  ending_direction: string
  structure_type: string
  main_plot: unknown
  subplots?: unknown
}): string =>
  canon({
    logline: a.logline,
    theme: a.theme,
    core_conflict: a.core_conflict,
    ending_direction: a.ending_direction,
    structure_type: a.structure_type,
    main_plot: parseMaybe(a.main_plot),
    subplots: parseMaybe(a.subplots ?? []),
  })

/* ==================== 转换 ==================== */

const anchorToVO = (e: OutlineAnchorEntity): OutlineAnchorVO => ({
  novel_id: e.novel_id,
  logline: e.logline,
  theme: e.theme,
  core_conflict: e.core_conflict,
  ending_direction: e.ending_direction,
  structure_type: e.structure_type,
  main_plot: JSON.parse(e.main_plot) as Plotline,
  subplots: JSON.parse(e.subplots) as Plotline[],
  locked_by_volume: e.locked_by_volume,
  locked_at: e.locked_at,
})

const toSnapshot = (a: OutlineAnchorVO): AnchorSnapshot => ({
  logline: a.logline,
  theme: a.theme,
  core_conflict: a.core_conflict,
  ending_direction: a.ending_direction,
  structure_type: a.structure_type,
  main_plot: a.main_plot,
  subplots: a.subplots,
})

const outlineToVO = (e: OutlineVolumeEntity, anchor: OutlineAnchorEntity | null): OutlineVolumeVO => {
  const snapshot = JSON.parse(e.anchor_snapshot) as AnchorSnapshot
  return {
    id: e.id,
    novel_id: e.novel_id,
    volume_id: e.volume_id,
    structure_type: e.structure_type,
    acts: JSON.parse(e.acts) as Act[],
    turning_points: JSON.parse(e.turning_points) as TurningPoint[],
    pacing: JSON.parse(e.pacing) as PacingPlan,
    constraints: JSON.parse(e.constraints) as OutlineConstraintsData,
    anchor_snapshot: snapshot,
    created_at: e.created_at,
    updated_at: e.updated_at,
    // 漂移 = 这卷当时回填的锚点，和现在生效的锚点不一样
    anchorDrift: anchor !== null && anchorCore(snapshot) !== anchorCore(anchor),
  }
}

/* ==================== 校验 ==================== */

const assertSaveDTO = (dto: SaveVolumeOutlineDTO): void => {
  if (!dto || typeof dto !== 'object') throw new TypeError('请求体必须是对象')
  if (!Number.isInteger(dto.novel_id)) throw new TypeError('novel_id 必须是整数')
  if (!dto.volume || typeof dto.volume !== 'object') throw new TypeError('volume 不能为空')
  if (!dto.outline || typeof dto.outline !== 'object') throw new TypeError('outline 不能为空')
  if (!dto.anchor || typeof dto.anchor !== 'object') throw new TypeError('anchor 不能为空')
  if (!Array.isArray(dto.chapters) || dto.chapters.length === 0) {
    throw new TypeError('chapters 不能为空数组 —— 一卷至少得有一章')
  }
}

/**
 * 章号三查：升序、连号、与卷的起止对齐。
 *
 * 这三条挡的是同一类事故：卷边界和章号悄悄对不上。
 * 让它在写库前失败，好过事后发现第 51 章跑到第一卷里去了。
 */
const assertChapterSeq = (dto: SaveVolumeOutlineDTO): void => {
  const list = dto.chapters
  let prev: { idx: number } | null = null
  for (const c of list) {
    if (!Number.isInteger(c.idx) || c.idx < 1) throw new TypeError(`章号 ${c.idx} 必须是正整数`)
    if (prev && c.idx !== prev.idx + 1) {
      throw new TypeError(`章号必须连号递增：上一章是 ${prev.idx}，这一章是 ${c.idx}`)
    }
    prev = c
  }

  const first = list[0]
  const last = list[list.length - 1]
  // assertSaveDTO 已经保证非空，这里只是让类型收窄
  if (!first || !last) throw new TypeError('chapters 不能为空数组')
  if (first.idx !== dto.volume.start_chapter) {
    throw new TypeError(`首章 ${first.idx} 与 volume.start_chapter ${dto.volume.start_chapter} 不一致`)
  }
  if (last.idx !== dto.volume.end_chapter) {
    throw new TypeError(`末章 ${last.idx} 与 volume.end_chapter ${dto.volume.end_chapter} 不一致`)
  }
}

/* ==================== 保存一卷 ==================== */

export interface SaveVolumeOutlineResult {
  volume: VolumeVO
  outline: OutlineVolumeVO
  chapters: ChapterBriefVO[]
  /** 传进来的锚点和已生效的锚点不一致 —— 这是缺陷，需要人工看 */
  anchorDrift: boolean
  /** 这一卷里原来有、但新名单里没有的章号。**没有自动删**，交给调用方决定 */
  orphaned: number[]
  /** 本次新建 / 更新的章数 */
  chaptersWritten: { created: number; updated: number }
}

/**
 * 保存一卷大纲。整卷一个事务，失败全回滚。
 *
 * 重跑同一卷是安全的：章节按 idx UPSERT，正文不会被碰。
 * 唯一可能"丢东西"的地方是 orphaned —— 但那些章只是不再属于本卷的名单，
 * 数据还在库里，删不删由调用方说了算。
 */
export const saveVolumeOutline = (dto: SaveVolumeOutlineDTO): SaveVolumeOutlineResult => {
  assertSaveDTO(dto)
  assertChapterSeq(dto)
  const ts = now()

  return withTransaction(() => {
    /* ---- 1. 卷：同一卷号就更新，否则新建 ---- */
    const existingVolume = volumeStore.selectVolumeByNo(dto.novel_id, dto.volume.no)
    let volumeId: number
    if (existingVolume) {
      volumeStore.updateVolumeRow(existingVolume.id, {
        name: dto.volume.name.trim(),
        goal: dto.volume.goal.trim(),
        from_state: dto.volume.from_state.trim(),
        to_state: dto.volume.to_state.trim(),
        start_chapter: dto.volume.start_chapter,
        end_chapter: dto.volume.end_chapter,
        updated_at: ts,
      })
      volumeId = existingVolume.id
    } else {
      volumeId = volumeStore.insertVolume({
        novel_id: dto.novel_id,
        no: dto.volume.no,
        name: dto.volume.name.trim(),
        goal: dto.volume.goal.trim(),
        from_state: dto.volume.from_state.trim(),
        to_state: dto.volume.to_state.trim(),
        start_chapter: dto.volume.start_chapter,
        end_chapter: dto.volume.end_chapter,
      })
    }
    const volumeRow = volumeStore.selectVolume(volumeId)!

    /* ---- 2. 锚点：只写一次，之后只读 ---- */
    let anchorRow = outlineStore.selectAnchor(dto.novel_id)
    let anchorDrift = false
    if (!anchorRow) {
      outlineStore.upsertAnchor({
        novel_id: dto.novel_id,
        logline: dto.anchor.logline,
        theme: dto.anchor.theme,
        core_conflict: dto.anchor.core_conflict,
        ending_direction: dto.anchor.ending_direction,
        structure_type: dto.anchor.structure_type,
        main_plot: JSON.stringify(dto.anchor.main_plot),
        subplots: JSON.stringify(dto.anchor.subplots ?? []),
        locked_by_volume: dto.volume.no,
      })
      anchorRow = outlineStore.selectAnchor(dto.novel_id)!
    } else {
      // 已有锚点就不覆盖。传进来的那份只用来判漂移
      anchorDrift = anchorCore(dto.anchor) !== anchorCore(anchorRow)
    }

    /* ---- 3. 章节：按 idx UPSERT，正文不动 ---- */
    const wanted = new Set(dto.chapters.map((c) => c.idx))
    let created = 0
    let updated = 0
    for (const c of dto.chapters) {
      const r = chapterService.upsertChapter(volumeRow, c, ts)
      if (r.created) created++
      else updated++
    }

    // 原来属于这一卷、这次名单里没有的章。只报不删 —— 删章会级联带走正文和裁决
    const orphaned = chapterStore
      .selectChaptersByVolume(volumeId)
      .filter((c) => !wanted.has(c.idx))
      .map((c) => c.idx)

    /* ---- 4. 卷大纲本体 ---- */
    // 快照存的是**这一卷实际提交的锚点**，不是库里已生效的那份。
    //
    // 这一条弄反了整个漂移检查就废了：存 canonical 的话，提交了不同锚点的那一卷
    // 快照看起来永远"没漂"，listDriftedVolumes 会永远返回空 ——
    // 写的时候报了漂移，读的时候找不到证据。（这个也是被断言脚本抓出来的。）
    const anchorSnapshot: AnchorSnapshot = {
      logline: dto.anchor.logline,
      theme: dto.anchor.theme,
      core_conflict: dto.anchor.core_conflict,
      ending_direction: dto.anchor.ending_direction,
      structure_type: dto.anchor.structure_type,
      main_plot: parseMaybe(dto.anchor.main_plot) as Plotline,
      subplots: (parseMaybe(dto.anchor.subplots ?? []) as Plotline[]),
    }

    const outlinePayload = {
      structure_type: dto.outline.structure_type,
      acts: JSON.stringify(dto.outline.acts),
      turning_points: JSON.stringify(dto.outline.turning_points),
      pacing: JSON.stringify(dto.outline.pacing),
      constraints: JSON.stringify(dto.outline.constraints),
      anchor_snapshot: JSON.stringify(anchorSnapshot),
    }

    const existingOutline = outlineStore.selectOutlineVolume(volumeId)
    if (existingOutline) {
      outlineStore.updateOutlineVolumeRow(volumeId, { ...outlinePayload, updated_at: ts })
    } else {
      outlineStore.insertOutlineVolume({ novel_id: dto.novel_id, volume_id: volumeId, ...outlinePayload })
    }

    /* ---- 5. 顺手登记待办：大纲有了，接下来该写正文 ---- */
    for (const c of dto.chapters) {
      const key = `ch:${String(c.idx).padStart(3, '0')}`
      if (!taskStore.selectTask(dto.novel_id, 'chapter', key)) {
        taskStore.insertTask({
          novel_id: dto.novel_id,
          stage: 'chapter',
          target_key: key,
          status: 'pending',
        })
      }
    }

    return {
      volume: volumeService.volumeToVO(volumeRow, true),
      outline: outlineToVO(outlineStore.selectOutlineVolume(volumeId)!, anchorRow),
      chapters: chapterStore.selectChapterBriefs(dto.novel_id, { volume_id: volumeId }),
      anchorDrift,
      orphaned,
      chaptersWritten: { created, updated },
    }
  })
}

/* ==================== 读 ==================== */

export const getAnchor = (novelId: number): OutlineAnchorVO | null => {
  const e = outlineStore.selectAnchor(novelId)
  return e ? anchorToVO(e) : null
}

/**
 * 单独写锚点。正常流程里不用调 —— saveVolumeOutline 第一卷时会自动写。
 * 留着是为了"卷还没排，先把骨架定下来"这种用法。
 */
export const saveAnchor = (dto: CreateAnchorDTO): OutlineAnchorVO => {
  const existing = outlineStore.selectAnchor(dto.novel_id)
  if (existing) {
    throw new TypeError('锚点已存在。改锚点应当重跑第一卷，不该原地改 —— 那会让已生成的卷无法判断是否漂移')
  }
  outlineStore.upsertAnchor({
    novel_id: dto.novel_id,
    logline: dto.logline,
    theme: dto.theme,
    core_conflict: dto.core_conflict,
    ending_direction: dto.ending_direction,
    structure_type: dto.structure_type,
    main_plot: JSON.stringify(dto.main_plot),
    subplots: JSON.stringify(dto.subplots ?? []),
    locked_by_volume: dto.locked_by_volume ?? null,
  })
  return anchorToVO(outlineStore.selectAnchor(dto.novel_id)!)
}

export const getVolumeOutline = (volumeId: number): OutlineVolumeVO | null => {
  const e = outlineStore.selectOutlineVolume(volumeId)
  if (!e) return null
  return outlineToVO(e, outlineStore.selectAnchor(e.novel_id))
}

export const listVolumeOutlines = (novelId: number): OutlineVolumeVO[] => {
  const anchor = outlineStore.selectAnchor(novelId)
  return outlineStore.selectOutlineVolumesByNovel(novelId).map((e) => outlineToVO(e, anchor))
}

/** 哪几卷的锚点跟现在生效的对不上。一条查询就能看出来的漂移报告 */
export const listDriftedVolumes = (novelId: number): number[] => {
  const anchor = outlineStore.selectAnchor(novelId)
  if (!anchor) return []
  return outlineStore
    .selectOutlineVolumesByNovel(novelId)
    .filter((e) => anchorCore(JSON.parse(e.anchor_snapshot) as AnchorSnapshot) !== anchorCore(anchor))
    .map((e) => e.volume_id)
}

/** 把提交上来的锚点和当前生效的比一下，不写库。给"提交前先看一眼"用 */
export const checkAnchorDrift = (
  novelId: number,
  submitted: Pick<
    CreateAnchorDTO,
    'logline' | 'theme' | 'core_conflict' | 'ending_direction' | 'structure_type' | 'main_plot' | 'subplots'
  >,
): { drift: boolean; hasAnchor: boolean } => {
  const anchor = outlineStore.selectAnchor(novelId)
  if (!anchor) return { drift: false, hasAnchor: false }
  return { drift: anchorCore(submitted) !== anchorCore(anchor), hasAnchor: true }
}

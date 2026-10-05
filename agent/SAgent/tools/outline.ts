import { tool } from 'langchain'
import * as z from 'zod'

import { createChapterRuntime } from '../chapterRuntime'
import { createOutlineRuntime, type AnchorInput } from '../outlineRuntime'
import { pack, rememberNovelEvent, withNovelDatabase } from './context'

/**
 * 大纲工具 —— 卷 + 卷纲 + 全篇锚点。
 *
 * ── 为什么 save_volume_outline 不含章节 ──
 * 一次调用 = 一卷（约 50 章），但 50 条章纲塞进一次工具调用会让参数巨大且中途失败全丢。
 * 所以拆开：这里只落**卷本身 + 卷级大纲（幕 / 转折点 / 节奏 / 约束）+ 锚点**，
 * 章节用 save_chapter_outline 逐条落（一条失败不影响其他条）。
 *
 * ── 锚点只由第一卷写 ──
 * 后续卷提交的锚点若与已定稿的不同，**不覆盖**，只在返回里报 drift。
 * 漂移是缺陷、要人看，不是让模型顺手改掉的东西。
 */
export const saveVolumeOutline = tool(
  async ({ volume, direction, structure, pacing, constraints }, config) =>
    withNovelDatabase(config, (database, novel) => {
      const chapters = createChapterRuntime(database)
      const outlines = createOutlineRuntime(database)

      const created = chapters.createVolume({
        no: volume.no,
        name: volume.name,
        goal: volume.goal,
        fromState: volume.from_state,
        toState: volume.to_state,
        startChapter: volume.start_chapter,
        endChapter: volume.end_chapter,
      })

      // 这一卷提交的锚点 —— 同时也是 outline_volumes 里要留的那份快照
      const anchorInput: AnchorInput = {
        logline: direction.logline,
        theme: direction.theme,
        coreConflict: direction.coreConflict,
        endingDirection: direction.endingDirection,
        structureType: structure.type,
        mainPlot: structure.mainPlot,
        subplots: structure.subplots ?? [],
        lockedByVolume: volume.no,
      }

      // 顺序有意义：先写锚点（第一卷），再写卷纲 —— 这样第一卷的快照和锚点一致、不误报漂移
      const anchor = outlines.saveAnchor(anchorInput)
      const outline = outlines.saveVolumeOutline({
        volumeId: created.volume.id,
        structureType: structure.type,
        acts: structure.acts ?? [],
        turningPoints: structure.turningPoints ?? [],
        pacing,
        constraints,
        anchorSnapshot: anchorInput,
      })

      rememberNovelEvent(novel.id, {
        title: `卷纲:${volume.name}`,
        content: JSON.stringify({ volume, direction, structureType: structure.type, acts: structure.acts ?? [] }),
        sourceType: 'volume_outline',
        sourceId: `volume:${created.volume.id}`,
        volumeId: created.volume.id,
      })

      return pack(`卷大纲已落库｜volume_id:${created.volume.id}｜第 ${volume.no} 卷`, {
        volumeId: created.volume.id,
        no: volume.no,
        volumeCreated: created.created,
        chaptersExpected: volume.end_chapter - volume.start_chapter + 1,
        锚点: { written: anchor.written, drift: anchor.drift },
        卷纲漂移: outline.drift,
      })
    }),
  {
    name: 'save_volume_outline',
    description:
      '落**一卷**的卷级大纲：卷（no/name/goal/起止章）+ 全篇锚点 + 卷纲（幕 / 转折点 / 节奏 / 约束）。返回 volume_id。' +
      '★ 一次一卷，按卷序调用；章节**不在这里**写，用 save_chapter_outline 逐条落。' +
      '★ direction / structure 原样传架构师（Architect）返回的那两块，不要自己裁；chapters 那一块直接忽略。' +
      '★ 全篇锚点由第一卷定稿，后续卷只是回填：若与已定稿的不一致，返回 drift=true 且**不覆盖** —— 那是模型擅自改锚点的信号，要检查。' +
      '★ 同一卷重跑是安全的：按卷号更新，不会堆出两条。',
    schema: z.object({
      volume: z.object({
        no: z.number().int().positive().describe('第几卷，从 1 开始。'),
        name: z.string(),
        goal: z.string().describe('这一卷要达成什么。'),
        from_state: z.string().describe('卷初状态。'),
        to_state: z.string().describe('卷末状态（必须与卷初不同，否则这一卷没有推进）。'),
        start_chapter: z.number().int().describe('起始章号（全篇连续编号）。'),
        end_chapter: z.number().int().describe('结束章号。'),
      }),
      direction: z.object({
        logline: z.string(),
        theme: z.string(),
        coreConflict: z.string(),
        endingDirection: z.string(),
      }),
      structure: z.object({
        type: z.string().describe('结构类型：three-act / four-act / hero-journey / custom。'),
        acts: z.array(z.unknown()).optional(),
        turningPoints: z.array(z.unknown()).optional(),
        mainPlot: z.unknown(),
        subplots: z.array(z.unknown()).optional(),
      }),
      pacing: z.unknown().optional().describe('节奏与张力曲线。'),
      constraints: z.unknown().optional().describe('本卷依赖的一致性约束。'),
    }),
  },
)

export const readOutline = tool(
  async ({ volume_id }, config) =>
    withNovelDatabase(config, (database) => {
      const chapters = createChapterRuntime(database)
      const outlines = createOutlineRuntime(database)
      const anchor = outlines.currentAnchor()

      // 带 volume_id = 取这一卷卷纲全文（幕 / 转折点 / 节奏 / 约束），排这一卷时才需要
      if (volume_id !== undefined) {
        const outline = outlines.getVolumeOutline(volume_id)
        if (!outline) throw new Error(`第 volume_id=${volume_id} 卷还没有卷纲`)
        const volume = chapters.getVolume(volume_id)
        return pack(`卷纲全文｜volume_id:${volume_id}`, {
          volume: volume ? { no: volume.no, name: volume.name, chapters: `${volume.startChapter}-${volume.endChapter}` } : null,
          structureType: outline.structureType,
          acts: outline.acts,
          turningPoints: outline.turningPoints,
          pacing: outline.pacing,
          constraints: outline.constraints,
          drift: outline.drift,
        })
      }

      const drifted = new Set(outlines.listDriftedVolumeIds())
      const outlineByVolume = new Map(outlines.listVolumeOutlines().map((o) => [o.volumeId, o]))
      const volumes = chapters.listVolumes()

      // 只回结构与状态，不回每卷的幕/转折点全文（那是排这一卷时才需要的资料）
      return pack('大纲索引与漂移检查', {
        锚点: anchor
          ? {
              logline: anchor.logline,
              theme: anchor.theme,
              coreConflict: anchor.coreConflict,
              endingDirection: anchor.endingDirection,
              structureType: anchor.structureType,
              lockedByVolume: anchor.lockedByVolume,
              有主线: anchor.mainPlot !== null && anchor.mainPlot !== undefined,
              支线数: Array.isArray(anchor.subplots) ? anchor.subplots.length : 0,
            }
          : null,
        卷: volumes.map((v) => ({
          no: v.no,
          volumeId: v.id,
          name: v.name,
          chapters: `${v.startChapter}-${v.endChapter}`,
          structureType: outlineByVolume.get(v.id)?.structureType ?? null,
          hasOutline: outlineByVolume.has(v.id),
          drift: drifted.has(v.id),
        })),
        漂移的卷: drifted.size === 0 ? [] : [...drifted],
      })
    }),
  {
    name: 'read_outline',
    description:
      '读大纲。**不带参数**：返回索引与状态 —— 全篇锚点（已定稿的那份）、每一卷的名字/章号区间/有没有卷纲/是否漂移。' +
      '**带 volume_id**：返回那一卷的卷纲全文（幕 / 转折点 / 节奏 / 约束）。' +
      '★ 排新一卷之前先用无参形式：确认锚点已定稿、上一卷到哪了、锚点有没有被改过（漂移）。',
    schema: z.object({ volume_id: z.number().int().positive().optional().describe('给 volume_id 就取那一卷的卷纲全文。') }),
  },
)

export const outlineTools = [saveVolumeOutline, readOutline]

import { tool } from 'langchain'
import * as z from 'zod'

import { createChapterRuntime, type ChapterOutlineInput } from '../chapterRuntime'
import { pack, rememberNovelEvent, withNovelDatabase } from './context'

/**
 * 章纲工具 —— 一章一条，逐条落。
 *
 * 为什么不做批量：一卷 50 章塞一次调用，参数巨大、失败全丢、还没法针对单章重跑。
 * 逐条落之后，重跑第 12 章不会碰到其他章。
 */
export const saveChapterOutline = tool(
  async (input, config) =>
    withNovelDatabase(config, (database, novel) => {
      const runtime = createChapterRuntime(database)
      const volume = runtime.getVolumeByNo(input.volume_no)
      if (!volume) throw new Error(`第 ${input.volume_no} 卷还没建档：先调 save_volume_outline 把卷落下来。`)

      const saved = runtime.saveChapterOutline(volume.id, {
        index: input.index,
        title: input.title,
        goal: input.goal,
        conflict: input.conflict,
        hook: input.hook,
        emotion: input.emotion,
        summary: input.summary,
        place: input.place,
        characters: input.characters,
        wordCountTarget: input.word_count_target,
      } as ChapterOutlineInput)

      const unresolved = saved.cast.filter((c) => c.characterId === null).map((c) => c.raw)

      rememberNovelEvent(novel.id, {
        title: `第${saved.chapter.idx}章章纲`,
        content: JSON.stringify(saved.chapter),
        sourceType: 'chapter_outline',
        sourceId: `chapter:${saved.chapter.id}:outline`,
        volumeId: volume.id,
        chapterId: saved.chapter.id,
      })

      return pack(`${saved.created ? '章纲已落库' : '章纲已更新'}｜第 ${saved.chapter.idx} 章（chapter_id:${saved.chapter.id}）`, {
        chapterId: saved.chapter.id,
        idx: saved.chapter.idx,
        volume_no: volume.no,
        created: saved.created,
        place: saved.chapter.placeRaw,
        cast: { total: saved.cast.length, resolved: saved.cast.length - unresolved.length, unresolved },
      })
    }),
  {
    name: 'save_chapter_outline',
    description:
      '落**一条**章纲，返回 chapter_id。一章一条、按章号顺序落。' +
      '★ volume_no 是卷号（不是 volume_id），卷必须先由 save_volume_outline 建好。' +
      '★ characters 里写**角色名字**；需要一个还不存在的角色时写 `NEW:戏剧功能`，不要现编名字 —— 那样会绕过"先建卡再出场"的约束。' +
      `★ place 同理：已有地名直接写，新地点写 NEW:戏剧功能。` +
      '★ 返回里的 cast.unresolved 就是"这一章点名了、但人/地还没建"的清单，接着去 save_character / save_location 把它补上。' +
      '★ 同一章重跑是更新（整条覆盖），不会堆出第二条；也不会动已写的正文。',
    schema: z.object({
      volume_no: z.number().int().positive().describe('第几卷。'),
      index: z.number().int().positive().describe('章号（全篇连续，不回卷内重开）。'),
      title: z.string().min(1),
      goal: z.string().optional().describe('本章目标。'),
      conflict: z.string().optional().describe('本章冲突。'),
      hook: z.string().optional().describe('结尾钩子。'),
      emotion: z.string().optional().describe('情绪走向。'),
      summary: z.string().optional().describe('本章概要。'),
      place: z.string().optional().describe('发生地：已有地名，或 `NEW:戏剧功能`。'),
      characters: z.array(z.string()).optional().describe('出场角色名，或 `NEW:戏剧功能`。'),
      word_count_target: z.number().int().positive().optional().describe('目标字数，缺省 3000。'),
    }),
  },
)

export const readChapters = tool(
  async ({ volume_no, idx }, config) =>
    withNovelDatabase(config, (database) => {
      const runtime = createChapterRuntime(database)

      // 带 idx = 一章的完整章纲 + 出场名单 + 正文到哪一步
      if (idx !== undefined) {
        const chapter = runtime.getChapter(idx)
        if (!chapter) throw new Error(`找不到第 ${idx} 章`)
        const final = runtime.getText(idx, 'final')
        const draft = runtime.getText(idx, 'draft')
        return pack(`第 ${idx} 章章纲（chapter_id:${chapter.id}）`, {
          ...chapter,
          textStage: final ? 'final' : draft ? 'draft' : 'none',
          cast: runtime.getCast(idx).map((c) => ({ raw: c.raw, characterId: c.characterId })),
        })
      }

      // 不带参数 = 全部章的索引 + 待办清单
      const volume = volume_no === undefined ? null : runtime.getVolumeByNo(volume_no)
      if (volume_no !== undefined && !volume) throw new Error(`第 ${volume_no} 卷不存在`)
      const chapters = runtime.listChapters(volume?.id)
      const volumeNoById = new Map(runtime.listVolumes().map((v) => [v.id, v.no]))

      const 待办 = runtime.pendingDemands().filter((d) => chapters.some((c) => c.idx === d.chapterIdx))

      return pack(`章节索引（${chapters.length} 章）${volume ? `｜第 ${volume.no} 卷` : ''}`, {
        章: chapters.map((c) => ({
          idx: c.idx,
          title: c.title,
          volume_no: volumeNoById.get(c.volumeId) ?? null,
          place: c.placeRaw,
          textStage: runtime.getText(c.idx, 'final') ? 'final' : runtime.getText(c.idx, 'draft') ? 'draft' : 'none',
          castCount: runtime.getCast(c.idx).length,
        })),
        待办: 待办.length === 0 ? [] : 待办,
      })
    }),
  {
    name: 'read_chapters',
    description:
      '读章节。**不带参数**：全部章的索引（章号 / 标题 / 卷号 / 地点 / 正文到哪一步 / 出场人数）+ **待办清单**。' +
      '**带 volume_no**：只看那一卷。**带 idx**：那一章的完整章纲 + 出场名单 + 正文阶段。' +
      '★ 待办清单 = 章纲里写了 `NEW:` 但还没兑现的角色/地点；`need` 就是派给 Character / Location agent 的输入。' +
      '★ 写正文前先用它确认：这一章有章纲、正文还没定稿、待办都清了。',
    schema: z.object({
      volume_no: z.number().int().positive().optional().describe('只看某一卷。'),
      idx: z.number().int().positive().optional().describe('取单章的完整章纲。'),
    }),
  },
)

export const chapterOutlineTools = [saveChapterOutline, readChapters]

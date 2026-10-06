import { tool } from 'langchain'
import * as z from 'zod'

import { chapter as chapterApi, type ChapterOutlineInput } from '../../my-app'
import { novelIdOf, pack } from './context'

/**
 * 章纲工具 —— 调 my-app 的 chapter controller。
 *
 * 早先只收单条，理由是「一卷 50 章塞一次调用，失败全丢」。那个风险是真的，
 * 所以这里不是简单地把参数放开成数组：**每一条各自提交、各自兜错** ——
 * 第 37 章撞了章号，前 36 章照样留在库里，失败的那条连同原因一起回到中心手上。
 * 逐条落的能力没有丢：传一条数组就是单章重跑，重跑第 12 章不会碰别的章。
 *
 * 章号是**全篇连续**的，不是卷内重开 —— 落错卷会撞 UNIQUE(idx)。
 */
export const saveChapterOutline = tool(
  async ({ volume_no, chapters }, config) => {
    const { volume, saved, failed } = chapterApi.saveChapterOutlines(
      novelIdOf(config),
      volume_no,
      chapters.map((item) => ({ ...item, wordCountTarget: item.word_count_target }) as ChapterOutlineInput),
    )

    const 待办 = saved.flatMap((c) => c.cast.unresolved.map((raw) => ({ idx: c.idx, raw })))

    return pack(
      `第 ${volume.no} 卷章纲：落库 ${saved.length} 条${failed.length ? `，失败 ${failed.length} 条` : ''}`,
      {
        volume_no: volume.no,
        请求: chapters.length,
        已落: saved.map((c) => ({ idx: c.idx, chapter_id: c.chapterId, created: c.created })),
        失败: failed,
        待办: 待办.length === 0 ? [] : 待办,
      },
    )
  },
  {
    name: 'save_chapter_outline',
    description:
      '落章纲，**一次可以传一条，也可以传一整卷**（一卷约 50 章就是一次调用），返回每一章的 chapter_id。' +
      '★ volume_no 是卷号（不是 volume_id），卷必须先由 save_volume_outline 建好。' +
      '★ 章号 index 是**全篇连续**的，不是卷内重开。' +
      '★ characters 里写**角色名字**；需要一个还不存在的角色时写 `NEW:戏剧功能`，不要现编名字 —— 那样会绕过「先建卡再出场」的约束。' +
      '★ place 同理：已有地名直接写，新地点写 NEW:戏剧功能。' +
      '★ **某一条失败不会影响其余各条**：失败的那条连原因一起回到「失败」里，你据此单独补一条重跑即可，不用整卷重来。' +
      '★ 返回里的「待办」就是"点名了、但人/地还没建"的清单，接着去 save_character / save_location 把它补上。' +
      '★ 同一章重跑是更新（整条覆盖），不会堆出第二条；也不会动已写的正文。',
    schema: z.object({
      volume_no: z.number().int().positive().describe('第几卷。'),
      chapters: z
        .array(
          z.object({
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
        )
        .min(1)
        .describe('要落的章纲。传一条 = 单章落库/重跑；传一整卷 = 一次落完。'),
    }),
  },
)

export const readChapters = tool(
  async ({ volume_no, idx }, config) => {
    const novelId = novelIdOf(config)

    // 带 idx = 一章的完整章纲 + 出场名单 + 正文到哪一步
    if (idx !== undefined) {
      const chapter = chapterApi.getChapter(novelId, idx)
      if (!chapter) throw new Error(`找不到第 ${idx} 章`)
      const final = chapterApi.getChapterText(novelId, idx, 'final')
      const draft = chapterApi.getChapterText(novelId, idx, 'draft')
      return pack(`第 ${idx} 章章纲（chapter_id:${chapter.id}）`, {
        ...chapter,
        textStage: final ? 'final' : draft ? 'draft' : 'none',
        cast: chapterApi.getChapterCast(novelId, idx).map((c) => ({ raw: c.raw, characterId: c.characterId })),
      })
    }

    // 不带参数 = 全部章的索引 + 待办清单
    const volume = volume_no === undefined ? null : chapterApi.getVolumeByNo(novelId, volume_no)
    if (volume_no !== undefined && !volume) throw new Error(`第 ${volume_no} 卷不存在`)
    const chapters = chapterApi.listChapters(novelId, volume?.id)
    const volumeNoById = new Map(chapterApi.listVolumes(novelId).map((v) => [v.id, v.no]))

    const 待办 = chapterApi.listPendingDemands(novelId).filter((d) => chapters.some((c) => c.idx === d.chapterIdx))

    return pack(`章节索引（${chapters.length} 章）${volume ? `｜第 ${volume.no} 卷` : ''}`, {
      章: chapters.map((c) => ({
        idx: c.idx,
        title: c.title,
        volume_no: volumeNoById.get(c.volumeId) ?? null,
        place: c.placeRaw,
        textStage: chapterApi.getChapterText(novelId, c.idx, 'final')
          ? 'final'
          : chapterApi.getChapterText(novelId, c.idx, 'draft')
            ? 'draft'
            : 'none',
        castCount: chapterApi.getChapterCast(novelId, c.idx).length,
      })),
      待办: 待办.length === 0 ? [] : 待办,
    })
  },
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

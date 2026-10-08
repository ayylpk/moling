import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { initializeNovelSchema } from '../db/connection'
import { createChapterRuntime } from '../db/chapterDB'
import { createDraftRuntime } from '../db/draftDB'
import { createWorldRuntime } from '../db/worldDB'
import { adoptProseDraft, adoptVolumeOutlineDraft, adoptWorldDraft } from './draftService'

/**
 * 采纳流程的 db 层测试（全部在内存库上跑，不起模型、不碰真实书库）。
 *
 * 钉住的是这几条红线：
 * - 没有草案就不能采纳（TypeError），正式表一行都不动；
 * - 采纳 = 写正式表 + 清草案，两件事一起完成；
 * - 失败的生成不会产生正式数据（这里没有"失败路径"可采纳——没草案就是没草案）。
 */

const setup = () => {
  const database = new Database(':memory:')
  initializeNovelSchema(database)
  return database
}

const NOVEL_ID = 1

describe('adoptWorldDraft（采纳世界观草案）', () => {
  test('没有草案时拒绝采纳，worlds 表保持为空', () => {
    const database = setup()
    expect(() => adoptWorldDraft(database, NOVEL_ID)).toThrow('没有待审核的草案')
    expect(createWorldRuntime(database).list()).toHaveLength(0)
    database.close()
  })

  test('采纳后：worlds 有正式版本、草案被清掉', () => {
    const database = setup()
    const drafts = createDraftRuntime(database)
    drafts.put('world', '', JSON.stringify({
      name: '临江',
      premise: '一段重来的人生。',
      rules: [{ ability: '回到过去', cost: '只能一次', limit: '不能改变记忆' }],
      places: [{ name: '临江老街' }],
    }))

    const world = adoptWorldDraft(database, NOVEL_ID)
    expect(world).toMatchObject({ version: 1, name: '临江' })
    // 正式表进了一行，草案没了
    expect(createWorldRuntime(database).current()).not.toBeNull()
    expect(drafts.has('world')).toBe(false)
    database.close()
  })
})

describe('adoptVolumeOutlineDraft（采纳卷纲草案，含章纲）', () => {
  test('采纳后：卷 + 卷纲 + 逐章章纲都落库，草案被清掉', () => {
    const database = setup()
    const drafts = createDraftRuntime(database)
    // 卷纲采纳以世界观为上游吗？—— saveVolumeOutlineWithMemory 不查世界观，
    // 但业务顺序由前置检查保证（这里测的是采纳本身的落库行为）。
    drafts.put('volume_outline', '1-2', JSON.stringify({
      range: '第 1–2 章',
      need: '立主线',
      volume: { no: 1, name: '第 1 卷', goal: '把人逼回临江', from_state: '逃避', to_state: '直面', start_chapter: 1, end_chapter: 2 },
      direction: { logline: '一段重来的人生', theme: '代价', coreConflict: '记忆与真相对不上', endingDirection: '接受代价' },
      structure: { type: 'three-act', acts: [], turningPoints: [], mainPlot: { id: 'm1', name: '主线' }, subplots: [] },
      pacing: { hookDensity: 1 },
      constraints: { timeline: '两周内', rules: [], forbidden: [] },
      chapters: [
        { index: 1, title: '回去的那天', goal: '回到过去', conflict: '记忆对不上', hook: '墙上多了张照片', emotion: '不安', summary: '主角回到过去第一天。', place: '临江老街', characters: ['林照'], wordCountTarget: 3000 },
        { index: 2, title: '多出来的照片', goal: '确认偏差', conflict: '证据指向自己', hook: '照片背面有自己的字', emotion: '心惊', summary: '主角发现记忆被改过。', place: '临江老街', characters: ['林照'], wordCountTarget: 3000 },
      ],
    }))

    const result = adoptVolumeOutlineDraft(database, NOVEL_ID)
    expect(result.volumeNo).toBe(1)
    expect(result.chapterReport.saved).toHaveLength(2)
    expect(result.chapterReport.saved.map((chapter) => chapter.idx)).toEqual([1, 2])
    // 草案清掉
    expect(drafts.has('volume_outline')).toBe(false)
    // 章真的在了
    expect(createChapterRuntime(database).listChapters()).toHaveLength(2)
    database.close()
  })
})

describe('adoptProseDraft（采纳正文终稿）', () => {
  const bookWithChapter = () => {
    const database = setup()
    const chapters = createChapterRuntime(database)
    const { volume } = chapters.createVolume({ no: 1, name: '第 1 卷', goal: '', fromState: '', toState: '', startChapter: 1, endChapter: 1 })
    chapters.saveChapterOutline(volume.id, { index: 1, title: '回去的那天', summary: '主角回到过去第一天。', wordCountTarget: 3000 })
    return database
  }

  test('没有草案时拒绝采纳', () => {
    const database = setup()
    expect(() => adoptProseDraft(database, NOVEL_ID, 1)).toThrow('没有待审核的正文草案')
    database.close()
  })

  test('采纳后：终稿落库、草案被清掉；多份草案不给章号会拒绝', () => {
    const database = bookWithChapter()
    const drafts = createDraftRuntime(database)
    drafts.put('prose', '1', JSON.stringify({ chapterIdx: 1, text: '第一章的润色稿。', summary: '主角回到过去第一天。', endsWith: '墙上多了张照片', polishReport: [] }))

    const saved = adoptProseDraft(database, NOVEL_ID, 1)
    expect(saved).toMatchObject({ stage: 'final' })
    expect(createChapterRuntime(database).getText(1, 'final')?.text).toContain('润色稿')
    expect(drafts.has('prose', '1')).toBe(false)

    // 章号不存在时明确报错，不猜
    drafts.put('prose', '99', JSON.stringify({ chapterIdx: 99, text: '不存在的章' }))
    expect(() => adoptProseDraft(database, NOVEL_ID, 99)).toThrow('没有第 99 章的章纲')
    database.close()
  })

  test('有多章草案且未指明章号时拒绝（不猜是哪一章）', () => {
    const database = bookWithChapter()
    const chapters = createChapterRuntime(database)
    const { volume } = chapters.createVolume({ no: 2, name: '第 2 卷', goal: '', fromState: '', toState: '', startChapter: 2, endChapter: 2 })
    chapters.saveChapterOutline(volume.id, { index: 2, title: '第二课' })

    const drafts = createDraftRuntime(database)
    drafts.put('prose', '1', JSON.stringify({ chapterIdx: 1, text: '第一章' }))
    drafts.put('prose', '2', JSON.stringify({ chapterIdx: 2, text: '第二章' }))
    expect(() => adoptProseDraft(database, NOVEL_ID)).toThrow('指明 chapterIdx')
    database.close()
  })
})

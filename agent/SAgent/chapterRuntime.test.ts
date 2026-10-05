import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { initializeNovelSchema } from '../storage/novelDatabase'
import { createChapterRuntime } from './chapterRuntime'
import { createCharacterRuntime } from './characterRuntime'

const setup = () => {
  const database = new Database(':memory:')
  initializeNovelSchema(database)
  return database
}

describe('center chapter sqlite runtime', () => {
  test('creates volumes, upserts chapter outlines, and tracks cast demands', () => {
    const database = setup()
    const characters = createCharacterRuntime(database)
    const runtime = createChapterRuntime(database)
    const lin = characters.create({ name: '林晚', role: 'protagonist' }).character

    const v2 = runtime.createVolume({ no: 2, name: '第二卷', startChapter: 4, endChapter: 6 })
    expect(v2.created).toBe(true)
    expect(runtime.getVolumeByNo(2)).toMatchObject({ name: '第二卷', startChapter: 4 })
    expect(runtime.maxVolumeNo()).toBe(2)

    const saved = runtime.saveChapterOutline(v2.volume.id, {
      index: 4,
      title: '重逢',
      goal: '认出旧人',
      place: 'NEW:一个能撞见仇人的地方',
      characters: ['林晚', 'new:一个出卖过他的同伴'],
    })
    expect(saved.created).toBe(true)
    expect(saved.chapter).toMatchObject({ volumeId: v2.volume.id, idx: 4, title: '重逢', placeRaw: 'NEW:一个能撞见仇人的地方', placeId: null })
    // 名字解析成 id；NEW: 统一成大写前缀且永不解析
    expect(saved.cast.map((c) => c.raw)).toEqual(['林晚', 'NEW:一个出卖过他的同伴'])
    expect(saved.cast[0]!.characterId).toBe(lin.id)
    expect(saved.cast[1]!.characterId).toBeNull()

    // 待办清单：一个角色需求 + 一个地点需求，都还没兑现
    expect(runtime.pendingDemands().map((d) => d.kind)).toEqual(['character', 'location'])

    // 同一章重跑是更新（整条覆盖），不会堆出第二条
    const again = runtime.saveChapterOutline(v2.volume.id, { index: 4, title: '重逢（改）', place: 'NEW:一个能撞见仇人的地方', characters: ['林晚'] })
    expect(again.created).toBe(false)
    expect(runtime.listChapters(v2.volume.id)).toHaveLength(1)
    expect(runtime.getCast(4).map((c) => c.raw)).toEqual(['林晚'])

    // 名单被重写后角色需求消失，地点需求还在
    const demands = runtime.pendingDemands()
    expect(demands).toHaveLength(1)
    expect(demands[0]).toMatchObject({ kind: 'location', chapterIdx: 4, need: '一个能撞见仇人的地方' })
    database.close()
  })

  test('back-fills cast when the character is created later', () => {
    const database = setup()
    const runtime = createChapterRuntime(database)
    const volume = runtime.createVolume({ no: 1, name: '第一卷', startChapter: 1, endChapter: 3 })

    runtime.saveChapterOutline(volume.volume.id, { index: 1, title: '雨夜', characters: ['沈九'] })
    expect(runtime.getCast(1)[0]!.characterId).toBeNull()

    const shen = createCharacterRuntime(database).create({ name: '沈九', role: 'antagonist' }).character
    expect(runtime.resolveCast('沈九', shen.id)).toBe(1)
    expect(runtime.getCast(1)[0]!.characterId).toBe(shen.id)
    database.close()
  })

  test('refuses a cross-volume chapter number instead of moving the row', () => {
    const database = setup()
    const runtime = createChapterRuntime(database)
    runtime.saveChapterOutline(runtime.createVolume({ no: 1, name: '第一卷', startChapter: 1, endChapter: 3 }).volume.id, { index: 1, title: '雨夜' })

    const v2 = runtime.createVolume({ no: 2, name: '第二卷', startChapter: 4, endChapter: 6 })
    expect(() => runtime.saveChapterOutline(v2.volume.id, { index: 1, title: '撞号' })).toThrow('第 1 章已属于别的卷')
    // 第一卷的第一章还在原地
    expect(runtime.getChapter(1)?.volumeId).toBe(1)
    database.close()
  })
})

describe('center chapter sqlite runtime — text and tasks', () => {
  const setupWithChapter = () => {
    const database = setup()
    const runtime = createChapterRuntime(database)
    runtime.saveChapterOutline(runtime.createVolume({ no: 1, name: '第一卷', startChapter: 1, endChapter: 3 }).volume.id, { index: 1, title: '雨夜', goal: '找到线索', conflict: '线索即将消失', hook: '门后有人' })
    return { database, runtime }
  }

  test('reads outlines, saves draft/final text, and reuses completed tasks', () => {
    const { database, runtime } = setupWithChapter()
    expect(runtime.getChapter(1)).toMatchObject({ idx: 1, title: '雨夜', goal: '找到线索' })

    const planned = runtime.planTask('chapter', '1', 'outline-v1')
    expect(planned.status).toBe('pending')
    const claimed = runtime.claimTask('chapter', '1', 'outline-v1')
    expect(claimed.action).toBe('run')

    runtime.saveText(1, { stage: 'draft', text: '初稿', summary: '找到线索。', endsWith: '门后有人。' })
    runtime.saveText(1, { stage: 'final', text: '终稿', summary: '找到线索。', endsWith: '门后有人。', polishReport: [{ kind: '节奏' }] })
    runtime.finishTask(claimed.taskId)

    expect(runtime.getText(1, 'final')).toMatchObject({ text: '终稿', summary: '找到线索。' })
    expect(runtime.claimTask('chapter', '1', 'outline-v1')).toMatchObject({ action: 'skip', taskId: claimed.taskId })
    database.close()
  })

  test('records failure and allows a later retry', () => {
    const { database, runtime } = setupWithChapter()
    runtime.planTask('chapter', '1')
    const claimed = runtime.claimTask('chapter', '1')
    runtime.failTask(claimed.taskId, '执笔模型超时')

    expect(runtime.getTask(claimed.taskId)).toMatchObject({ status: 'failed', error: '执笔模型超时' })
    expect(runtime.claimTask('chapter', '1')).toMatchObject({ action: 'run', taskId: claimed.taskId })
    database.close()
  })
})

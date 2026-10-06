import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { initializeNovelSchema } from './connection'
import { createChapterRuntime } from './chapterDB'
import { createCharacterRuntime } from './characterDB'
import { createDecisionRuntime } from './actorDecisionDB'

const setup = () => {
  const database = new Database(':memory:')
  initializeNovelSchema(database)
  const chapters = createChapterRuntime(database)
  chapters.saveChapterOutline(chapters.createVolume({ no: 1, name: '第一卷', startChapter: 1, endChapter: 3 }).volume.id, { index: 1, title: '雨夜' })
  createCharacterRuntime(database).create({ name: '林晚', role: 'protagonist' })
  return database
}

const base = {
  chapterIdx: 1,
  characterName: '林晚',
  situation: '仇人就在门外',
  options: { A: '开门', B: '装作不在', C: '跳窗', chatPrompt: '自己说' },
  choice: 'B' as const,
  reason: '她还没准备好',
  line: '今天不见客。',
  promptHash: 'h1',
}

describe('center decision sqlite runtime', () => {
  test('reuses a decision by prompt hash and builds the writer block', () => {
    const database = setup()
    const runtime = createDecisionRuntime(database)

    const first = runtime.save(base)
    expect(first.reused).toBe(false)
    expect(first.decision).toMatchObject({ characterName: '林晚', choice: 'B', chapterIdx: 1 })

    // 同一问不重问：返回上一条，不新增（这就是省下 Actor 调用的地方）
    const second = runtime.save(base)
    expect(second.reused).toBe(true)
    expect(second.decision.id).toBe(first.decision.id)
    expect(runtime.list(1)).toHaveLength(1)

    // 未建卡的角色：character_id 落 NULL，同一问也不会重复
    const ghost = { ...base, characterName: '还没建的人', promptHash: 'h2' }
    const g1 = runtime.save(ghost)
    const g2 = runtime.save(ghost)
    expect(g1.decision.characterId).toBeNull()
    expect(g2.reused).toBe(true)
    expect(runtime.list(1)).toHaveLength(2)

    const block = runtime.buildDecisionsText(1)
    expect(block.count).toBe(2)
    expect(block.text).toContain('【林晚】')
    expect(block.text).toContain('他选了：B')
    expect(block.text).toContain('（未建卡的角色）')
    // 没有裁决的章节给明确的"无"，不是空串
    expect(runtime.buildDecisionsText(2).text).toContain('（无。')
    database.close()
  })

  test('requires a custom answer when choice is D', () => {
    const database = setup()
    const runtime = createDecisionRuntime(database)
    expect(() => runtime.save({ ...base, choice: 'D' })).toThrow('choice = D 时必须给出 customAnswer')
    database.close()
  })
})

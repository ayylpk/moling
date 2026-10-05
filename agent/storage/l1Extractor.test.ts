import { describe, expect, test } from 'bun:test'
import { createNovelL1Extractor, parseNovelL1Output } from './l1Extractor'

describe('novel L1 extractor', () => {
  test('parses facts, filters noise, and removes duplicate candidates', () => {
    const facts = parseNovelL1Output(JSON.stringify({ facts: [
      { title: '责任感变化', content: '沈砚冒险救下护卫，表现出愿意承担责任。', category: 'character_state', confidence: 0.92 },
      { title: '重复事实', content: '沈砚冒险救下护卫，表现出愿意承担责任。', category: 'character_state', confidence: 0.8 },
      { title: '闲聊', content: '好的', category: 'scene', confidence: 0.99 },
      { title: '规则', content: '灵脉潮汐时不能强行突破。', category: 'world_rule', confidence: 0.88 },
    ] }))

    expect(facts).toHaveLength(2)
    expect(facts[0]?.category).toBe('character_state')
    expect(facts[1]?.category).toBe('world_rule')
  })

  test('creates a prompt-bound extractor and restores source scope', async () => {
    let prompt = ''
    const extractor = createNovelL1Extractor({ invoke: async (input) => { prompt = input; return JSON.stringify({ facts: [{ title: '事件结果', content: '沈砚主动承担救援责任。', category: 'character_state', confidence: 0.9 }] }) } })
    const facts = await extractor({ novelId: 'demo', title: '第三章', content: '沈砚救下护卫。', sourceType: 'chapter_text', sourceId: 'chapter:3', chapterId: 3 })

    expect(prompt).toContain('第三章')
    expect(facts[0]).toMatchObject({ novelId: 'demo', sourceType: 'chapter_text', sourceId: 'chapter:3:fact:1', chapterId: 3, confidence: 0.9 })
    expect(facts[0]?.metadata).toMatchObject({ category: 'character_state', extractor: 'novel-l1' })
  })
})

import { describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { initializeNovelSchema } from './novelDatabase'
import { createPortraitPipeline } from './portraitPipeline'

const createPipeline = (options?: { embed: (input: string[]) => Promise<number[][]> }) => {
  const database = new Database(':memory:')
  initializeNovelSchema(database)
  return { database, pipeline: createPortraitPipeline(database, options ?? { embed: async () => [[1, 0]] }) }
}

describe('novel L0/L1/L3 memory pipeline', () => {
  test('keeps a raw event, promotes a fact, and updates the character portrait', async () => {
    const { database, pipeline } = createPipeline()
    const raw = await pipeline.recordEvent({ novelId: 'demo', title: '渡河', content: '沈砚在雨夜救下了受伤的商队护卫。', sourceType: 'chapter', sourceId: 'chapter:3', characterId: 7, chapterId: 3 })
    const fact = await pipeline.recordFact({ novelId: 'demo', title: '沈砚愿意承担风险', content: '沈砚在雨夜冒险救下受伤的护卫，表现出强烈的责任感。', sourceType: 'chapter', sourceId: 'chapter:3', characterId: 7, chapterId: 3, confidence: 0.9 })
    const portrait = await pipeline.updatePortrait({ novelId: 'demo', characterId: 7, profile: '当前更愿意承担风险保护无辜者。', tags: ['责任感', '冒险'], basedOnFactIds: [fact.id] })

    expect(raw.id).toBeGreaterThan(0)
    expect(pipeline.getPortrait('demo', 7)).toMatchObject({ characterId: 7, version: 1, profile: '当前更愿意承担风险保护无辜者。' })
    expect(portrait.memoryId).toBeGreaterThan(0)
    expect(database.query('SELECT stage FROM memory_items ORDER BY id').all()).toEqual([{ stage: 'L0' }, { stage: 'L1' }, { stage: 'L3' }])
    database.close()
  })

  test('retries a failed portrait embedding without losing the portrait update', async () => {
    const { database, pipeline } = createPipeline({ embed: async () => { throw new Error('temporary provider failure') } })
    const result = await pipeline.updatePortrait({ novelId: 'demo', characterId: 2, profile: '画像内容', tags: ['新线索'], basedOnFactIds: [] })
    expect(result.embeddingPending).toBe(true)
    expect(pipeline.getPortrait('demo', 2)?.version).toBe(1)
    database.close()
  })
})

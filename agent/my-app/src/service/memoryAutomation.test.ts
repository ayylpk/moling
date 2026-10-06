import { describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { initializeNovelSchema } from '../db/connection'
import { createMemoryAutomation } from './memoryAutomation'

describe('automatic novel memory flow', () => {
  test('captures L0 and promotes extracted candidates to L1', async () => {
    const database = new Database(':memory:')
    initializeNovelSchema(database)
    const automation = createMemoryAutomation(database, { embed: async () => [[1, 0]] })
    const event = await automation.capture({ novelId: 'demo', title: '渡河', content: '沈砚救下护卫。', sourceType: 'chapter', sourceId: 'chapter:3', characterId: 7, chapterId: 3 })

    expect(event.stage).toBe('L0')
    expect(automation.pending()).toBe(1)
    const processed = await automation.processNext(async (raw) => [{ novelId: raw.novelId, title: '责任感事实', content: `${raw.content} 说明沈砚愿意承担责任。`, sourceType: 'derived', sourceId: `fact:${raw.sourceId}`, characterId: 7, chapterId: 3, confidence: 0.9 }])

    expect(processed.status).toBe('done')
    expect(processed.factIds).toHaveLength(1)
    expect(automation.pending()).toBe(0)
    expect(database.query("SELECT stage FROM memory_items ORDER BY stage").all()).toEqual([{ stage: 'L0' }, { stage: 'L1' }])
    database.close()
  })

  test('keeps the job retryable after extraction failure', async () => {
    const database = new Database(':memory:')
    initializeNovelSchema(database)
    const automation = createMemoryAutomation(database, { embed: async () => [[1, 0]], maxAttempts: 2 })
    await automation.capture({ novelId: 'demo', title: '事件', content: '原始内容', sourceType: 'chapter', sourceId: 'chapter:4' })
    const result = await automation.processNext(async () => { throw new Error('extractor unavailable') })

    expect(result.status).toBe('retry')
    expect(automation.pending()).toBe(1)
    expect(database.query('SELECT attempts, status FROM memory_jobs').get()).toMatchObject({ attempts: 1, status: 'pending' })
    database.close()
  })
})

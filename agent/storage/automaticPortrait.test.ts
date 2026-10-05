import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { initializeNovelSchema } from './novelDatabase'
import { createAutomaticPortraitUpdater } from './automaticPortrait'

describe('automatic novel portrait update', () => {
  test('turns character facts into the latest L3 portrait without approval', async () => {
    const database = new Database(':memory:')
    initializeNovelSchema(database)
    const updater = createAutomaticPortraitUpdater({
      invoke: async () => JSON.stringify({ profile: '沈砚开始主动承担救援责任，并对林晚产生保护倾向。', tags: ['责任感', '保护欲'] }),
    }, database, 'demo', { embed: async () => [[0.2, 0.8]] })
    const factId = Number(database.query(`INSERT INTO memory_items (novel_id, stage, layer, title, content, source_type, source_id, metadata) VALUES ('demo', 'L1', 'fact', '状态', '沈砚主动承担救援责任。', 'l1:agent', 'fact:1', '{"characterId":7,"category":"character_state","confidence":0.9}')`).run().lastInsertRowid)

    const result = await updater([factId])

    expect(result).toEqual([7])
    expect(database.query('SELECT profile, tags, based_on_fact_ids FROM character_portraits').get()).toMatchObject({
      profile: '沈砚开始主动承担救援责任，并对林晚产生保护倾向。',
      tags: '["责任感","保护欲"]',
      based_on_fact_ids: `[${factId}]`,
    })
    database.close()
  })
})

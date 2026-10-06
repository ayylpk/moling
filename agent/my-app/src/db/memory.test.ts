import { describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { initializeNovelSchema } from './connection'
import { createMemoryStore, rrfMerge, type MemoryRecord } from './memoryStore'

const createStore = () => {
  const database = new Database(':memory:')
  initializeNovelSchema(database)
  return { database, store: createMemoryStore(database) }
}

describe('novel memory store', () => {
  test('merges independent recall lists with reciprocal rank fusion', () => {
    const keyword = [{ id: 'keyword-first' }, { id: 'shared' }]
    const vector = [{ id: 'shared' }, { id: 'vector-second' }]
    const results = rrfMerge([keyword, vector], (item) => item.id)

    expect(results[0]?.id).toBe('shared')
    expect(results[0]?.rrfScore).toBeGreaterThan(results[1]?.rrfScore ?? 0)
  })

  test('stores a memory and finds it by full-text query', () => {
    const { database, store } = createStore()
    store.upsert({
      novelId: 'demo',
      layer: 'world',
      title: '灵脉规则',
      content: '灵脉每七年潮汐一次，潮汐时不能强行突破。',
      sourceType: 'world',
      sourceId: 'world-1',
    })

    const results = store.search({ novelId: 'demo', query: '灵脉 潮汐', limit: 5 })
    expect(results).toHaveLength(1)
    expect(results[0]?.title).toBe('灵脉规则')
    database.close()
  })

  test('filters recall to the requested novel and scope', () => {
    const { database, store } = createStore()
    const records: MemoryRecord[] = [
      { novelId: 'demo', layer: 'chapter', title: '第一章', content: '沈砚进入长安城。', sourceType: 'chapter', sourceId: 'chapter-1', volumeId: 1, chapterId: 1 },
      { novelId: 'demo', layer: 'world', title: '世界观', content: '长安城有九座城门。', sourceType: 'world', sourceId: 'world-1' },
      { novelId: 'other', layer: 'chapter', title: '别的小说', content: '沈砚进入长安城。', sourceType: 'chapter', sourceId: 'chapter-9', volumeId: 1, chapterId: 9 },
    ]
    for (const record of records) store.upsert(record)

    const results = store.search({ novelId: 'demo', query: '长安城', volumeId: 1, chapterId: 1, limit: 5 })
    expect(results.map((result) => result.sourceId)).toEqual(['chapter-1'])
    database.close()
  })

  test('uses vector recall when an embedding provider is supplied', () => {
    const { database, store } = createStore()
    store.upsert({ novelId: 'demo', layer: 'character', title: '沈砚', content: '沈砚擅长观察局势。', sourceType: 'character', sourceId: 'character-1', embedding: [1, 0] })
    store.upsert({ novelId: 'demo', layer: 'character', title: '林妄', content: '林妄擅长伪装身份。', sourceType: 'character', sourceId: 'character-2', embedding: [0, 1] })

    const results = store.search({ novelId: 'demo', query: '局势', embedding: [0.95, 0.05], limit: 1 })
    expect(results[0]?.sourceId).toBe('character-1')
    expect(results[0]?.match).toBe('hybrid')
    database.close()
  })

  test('filters memory recall by story layer', () => {
    const { database, store } = createStore()
    store.upsert({ novelId: 'demo', layer: 'world', title: '城门', content: '长安城有九座城门。', sourceType: 'world', sourceId: 'world-1' })
    store.upsert({ novelId: 'demo', layer: 'chapter', title: '进城', content: '沈砚进入长安城。', sourceType: 'chapter', sourceId: 'chapter-1' })

    const results = store.search({ novelId: 'demo', query: '长安城', layer: 'world', limit: 5 })
    expect(results.map((result) => result.sourceId)).toEqual(['world-1'])
    database.close()
  })
})

import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { initializeNovelSchema } from './connection'
import { createDraftRuntime } from './draftDB'

const setup = () => {
  const database = new Database(':memory:')
  initializeNovelSchema(database)
  return database
}

describe('draft sqlite runtime（待审核草案）', () => {
  test('put/get/has：草案可暂存、读取、覆盖', () => {
    const database = setup()
    const drafts = createDraftRuntime(database)

    expect(drafts.has('world')).toBe(false)
    drafts.put('world', '', JSON.stringify({ name: '临江', premise: '一段重来的人生。' }))
    expect(drafts.has('world')).toBe(true)
    const first = drafts.get('world')!
    expect(first.stage).toBe('world')
    expect(JSON.parse(first.content)).toMatchObject({ name: '临江' })

    // 覆盖式：重生成只替换内容，不堆行
    drafts.put('world', '', JSON.stringify({ name: '临江', premise: '改过的前提。' }))
    expect(database.query('SELECT count(*) AS count FROM drafts').get()).toEqual({ count: 1 })
    expect(JSON.parse(drafts.get('world')!.content)).toMatchObject({ premise: '改过的前提。' })
    expect(drafts.get('world')!.updatedAt >= first.updatedAt).toBe(true)
    database.close()
  })

  test('targetKey 隔离：同一阶段不同对象互不覆盖', () => {
    const database = setup()
    const drafts = createDraftRuntime(database)

    drafts.put('prose', '1', JSON.stringify({ text: '第一章' }))
    drafts.put('prose', '2', JSON.stringify({ text: '第二章' }))
    expect(drafts.list('prose')).toHaveLength(2)
    expect(JSON.parse(drafts.get('prose', '1')!.content)).toMatchObject({ text: '第一章' })

    // 只清一章：另一章草案不受影响
    expect(drafts.clear('prose', '1')).toBe(1)
    expect(drafts.has('prose', '1')).toBe(false)
    expect(drafts.has('prose', '2')).toBe(true)
    database.close()
  })

  test('clear：按阶段清空，不动别的阶段', () => {
    const database = setup()
    const drafts = createDraftRuntime(database)

    drafts.put('world', '', '{}')
    drafts.put('volume_outline', '1-10', '{}')
    drafts.put('cast', '林照', '{}')
    expect(drafts.clear('volume_outline')).toBe(1)
    expect(drafts.has('world')).toBe(true)
    expect(drafts.has('cast', '林照')).toBe(true)
    expect(drafts.has('volume_outline', '1-10')).toBe(false)
    database.close()
  })

  test('不同小说的草案互不串联：一本一个库，连读的机会都没有', () => {
    const bookA = setup()
    const bookB = setup()
    createDraftRuntime(bookA).put('world', '', JSON.stringify({ premise: 'A 书的世界' }))
    expect(createDraftRuntime(bookB).has('world')).toBe(false)
    bookA.close()
    bookB.close()
  })
})

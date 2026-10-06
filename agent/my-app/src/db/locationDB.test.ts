import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { initializeNovelSchema } from './connection'
import { createLocationRuntime } from './locationDB'

const setup = () => {
  const database = new Database(':memory:')
  initializeNovelSchema(database)
  return database
}

describe('center location sqlite runtime', () => {
  test('keeps an unresolved parent as a todo and back-fills it later', () => {
    const database = setup()
    const runtime = createLocationRuntime(database)

    // 先建细粒度地点，父地点还不存在 → parent_id 留 NULL，是待办状态不是错误
    const child = runtime.create({ name: '旧观的水井', parent: '青州' })
    expect(child.location.parentRaw).toBe('青州')
    expect(child.location.parentId).toBeNull()

    const parent = runtime.create({ name: '青州', signature: '半城是水', features: ['潮声', '青石'], role: '起点' })
    expect(parent.location.features).toEqual(['潮声', '青石'])
    expect(runtime.unresolvedParents().map((l) => l.name)).toEqual(['旧观的水井'])

    expect(runtime.resolvePendingChildren('青州', parent.location.id)).toBe(1)
    expect(runtime.get(child.location.id)?.parentId).toBe(parent.location.id)
    expect(runtime.unresolvedParents()).toHaveLength(0)
    expect(runtime.children(parent.location.id).map((l) => l.name)).toEqual(['旧观的水井'])
    database.close()
  })

  test('never resolves a NEW: demand and updates in place', () => {
    const database = setup()
    const runtime = createLocationRuntime(database)
    const need = runtime.create({ name: '枯井', parent: 'NEW:一个能撞见仇人的地方' })

    expect(need.location.parentId).toBeNull()
    expect(need.location.parentRaw).toBe('NEW:一个能撞见仇人的地方')

    const moved = runtime.update(need.location.id, { role: '藏尸处', parentId: null })
    expect(moved).toMatchObject({ role: '藏尸处', parentId: null })
    database.close()
  })

  test('rejects an empty name', () => {
    const database = setup()
    expect(() => createLocationRuntime(database).create({ name: ' ' })).toThrow('name 不能为空')
    database.close()
  })
})

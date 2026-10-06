import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { initializeNovelSchema } from './connection'
import { createLocationRuntime } from './locationDB'
import { createWorldRuntime } from './worldDB'

const setup = () => {
  const database = new Database(':memory:')
  initializeNovelSchema(database)
  return database
}

describe('center world sqlite runtime', () => {
  test('creates versions and always reads the newest world', () => {
    const database = setup()
    const runtime = createWorldRuntime(database)
    const first = runtime.create({ name: '临江', premise: '一段重来的人生。', rules: [{ ability: '回到过去', cost: '只能一次', limit: '不能改变记忆' }], terms: [{ name: '临江三中' }] })
    const second = runtime.create({ name: '临江', premise: '一段重来的人生。', rules: [{ ability: '回到过去', cost: '代价更重', limit: '不能改变记忆' }] })

    expect(first).toMatchObject({ version: 1, name: '临江' })
    expect(second).toMatchObject({ version: 2 })
    expect(runtime.current()).toMatchObject({ id: second.id, version: 2, rules: [{ cost: '代价更重' }] })
    expect(runtime.list()).toHaveLength(2)
    database.close()
  })

  test('rejects an empty premise before writing', () => {
    const database = setup()
    expect(() => createWorldRuntime(database).create({ name: '临江', premise: ' ' })).toThrow('premise 不能为空')
    expect(database.query('SELECT count(*) AS count FROM worlds').get()).toEqual({ count: 0 })
    database.close()
  })

  /**
   * 世界观里的地名粗骨架必须落进 locations 表。
   * 不落的话，凡 parent 填了骨架地名的地点卡，parent_id 永远是 NULL，
   * 而且 unresolvedParents() 会一直报它 —— 没有任何东西会去建那条父级行。
   */
  test('materializes world places into locations so children can resolve their parent', () => {
    const database = setup()
    createWorldRuntime(database).create({
      name: '临江',
      premise: '老街上的三口之家。',
      places: [{ name: '临江老街', where: '城南', role: '全书的根' }],
    })

    const locations = createLocationRuntime(database)
    expect(locations.getByName('临江老街')).toMatchObject({ name: '临江老街', parentId: null, features: ['城南'] })

    const child = locations.create({ name: '老粮站晒台', parent: '临江老街' })
    expect(child.location.parentId).toBe(locations.getByName('临江老街')!.id)
    expect(locations.unresolvedParents()).toHaveLength(0)
    database.close()
  })

  /** 反序：地点卡先建（当时解析不出父级），世界观后落 —— 物化时要回头把孤儿挂上 */
  test('back-fills children that were created before the world landed', () => {
    const database = setup()
    const locations = createLocationRuntime(database)
    expect(locations.create({ name: '渡船上', parent: '渡口' }).location.parentId).toBeNull()
    expect(locations.unresolvedParents()).toHaveLength(1)

    createWorldRuntime(database).create({ name: '临江', premise: '渡口边的小城。', places: [{ name: '渡口', where: '老码头' }] })

    expect(locations.getByName('渡船上')!.parentId).toBe(locations.getByName('渡口')!.id)
    expect(locations.unresolvedParents()).toHaveLength(0)
    database.close()
  })
})

import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { initializeNovelSchema } from '../storage/novelDatabase'
import { createWorldRuntime } from './worldRuntime'

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
})

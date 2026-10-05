import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { initializeNovelSchema } from '../storage/novelDatabase'
import { createCharacterRuntime } from './characterRuntime'

const setup = () => {
  const database = new Database(':memory:')
  initializeNovelSchema(database)
  return database
}

describe('center character sqlite runtime', () => {
  test('creates a card, lists it, and updates it in place', () => {
    const database = setup()
    const runtime = createCharacterRuntime(database)
    const { character, created } = runtime.create({ name: '林晚', role: 'protagonist', want: '活下去', arc: { start: '怯', end: '敢' } })

    expect(created).toBe(true)
    expect(character).toMatchObject({ name: '林晚', role: 'protagonist', want: '活下去', arcStart: '怯', arcEnd: '敢', status: 'alive', source: 'agent' })

    const updated = runtime.update(character.id, { status: 'dead', line: '不欠人情' })
    // 改一处不该动另一处 —— 原地 UPDATE，不是整卡重写
    expect(updated).toMatchObject({ id: character.id, status: 'dead', line: '不欠人情', want: '活下去' })
    expect(runtime.list()).toHaveLength(1)
    expect(runtime.briefs()[0]).toMatchObject({ name: '林晚', role: 'protagonist' })
    database.close()
  })

  test('is idempotent by name and never touches character_portraits', () => {
    const database = setup()
    const runtime = createCharacterRuntime(database)
    const first = runtime.create({ name: '林晚', role: 'protagonist' })
    const again = runtime.create({ name: '林晚', role: 'support' })

    expect(again.created).toBe(false)
    expect(again.character.id).toBe(first.character.id)
    expect(again.character.role).toBe('protagonist')
    // 固定设定（characters）与动态画像（character_portraits）互补，runtime 不碰画像
    expect(database.query('SELECT count(*) AS c FROM character_portraits').get()).toEqual({ c: 0 })
    database.close()
  })

  test('rejects an empty name before writing', () => {
    const database = setup()
    expect(() => createCharacterRuntime(database).create({ name: ' ', role: 'support' })).toThrow('name 不能为空')
    expect(database.query('SELECT count(*) AS c FROM characters').get()).toEqual({ c: 0 })
    database.close()
  })
})

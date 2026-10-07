import { Database } from 'bun:sqlite'
import { beforeEach, describe, expect, test } from 'bun:test'
import { initializeCatalogSchema } from '../db/connection'
import { applyNovelFlavors } from './catalogService'

/**
 * 改已建好那本书的题材与文风。
 *
 * 只测纯 SQL 那层（`applyNovelFlavors`），用 `:memory:` 库 —— 真跑一遍
 * `updateNovelFlavorsInCatalog` 会打开 resources/ 下作者**真正的** catalog.sqlite，
 * 测试不该碰它。开库关库那两行没有分支，不值得为它引一个可注入的存储根。
 */

const seed = (genre: string, style: string) => {
  const database = new Database(':memory:')
  initializeCatalogSchema(database)
  database.query("INSERT INTO novels (slug, title, genre, style) VALUES ('qingshu', '青梅', ?, ?)").run(genre, style)
  return database
}

describe('改题材与文风', () => {
  let database: Database
  beforeEach(() => { database = seed('都市', '冷峻克制') })
  /** 每例自己关 —— bun 的 beforeEach 不负责收尾，漏掉会留下句柄 */

  test('只给一个字段时，另一个保持原样（不是清空）', () => {
    const updated = applyNovelFlavors(database, 1, { genre: '悬疑' })
    expect(updated.genre).toBe('悬疑')
    expect(updated.style).toBe('冷峻克制')
    database.close()
  })

  test('两个都给时一起换掉', () => {
    const updated = applyNovelFlavors(database, 1, { genre: '现实', style: '细腻绵密' })
    expect(updated).toMatchObject({ genre: '现实', style: '细腻绵密' })
    database.close()
  })

  test('空串 = 清掉，不是"没给"', () => {
    const updated = applyNovelFlavors(database, 1, { genre: '', style: '' })
    expect(updated).toMatchObject({ genre: '', style: '' })
    database.close()
  })

  test('写了库里的名字，返回体就是那一行（不是请求体回声）', () => {
    // 名字前后带空白要被 trim —— 否则「冷峻克制 」在页面上看着对、比对起来不等，
    // 而拼不到片段目录，整本书的文风会静默失效
    const updated = applyNovelFlavors(database, 1, { style: '  冷峻克制  ' })
    expect(updated.style).toBe('冷峻克制')
    database.close()
  })

  test('什么都不给 → 抛错，且不写库', () => {
    expect(() => applyNovelFlavors(database, 1, {})).toThrow('至少要给')
    expect(database.query('SELECT genre, style FROM novels WHERE id = 1').get()).toMatchObject({ genre: '都市', style: '冷峻克制' })
    database.close()
  })

  test('不存在的书 → 抛「小说不存在」（HTTP 层照这个前缀给 404）', () => {
    expect(() => applyNovelFlavors(database, 999, { genre: '都市' })).toThrow(/^小说不存在/)
    database.close()
  })

  test('超长的名字被拒 —— 目录名有长度上限，放进去会变成建不出的目录', () => {
    expect(() => applyNovelFlavors(database, 1, { genre: '都'.repeat(65) })).toThrow('genre 太长')
    expect(() => applyNovelFlavors(database, 1, { style: '冷'.repeat(201) })).toThrow('style 太长')
    database.close()
  })
})

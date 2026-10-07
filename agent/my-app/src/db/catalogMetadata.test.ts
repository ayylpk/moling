import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { initializeCatalogSchema } from './connection'

const columnNames = (database: Database): string[] =>
  (database.query('PRAGMA table_info(novels)').all() as Array<{ name: string }>).map((column) => column.name)

describe('小说 catalog 元数据', () => {
  test('新建 catalog 包含小说简介、目标字数和主题字段', () => {
    const database = new Database(':memory:')
    try {
      initializeCatalogSchema(database)
      expect(columnNames(database)).toEqual(expect.arrayContaining(['description', 'logline', 'target_words', 'themes']))
      const novel = database.query("SELECT description, logline, target_words, themes FROM novels WHERE id = 1").get()
      expect(novel).toBeNull()
    } finally {
      database.close()
    }
  })

  test('旧 catalog 自动迁移并保留原有小说', () => {
    const database = new Database(':memory:')
    try {
      database.run("CREATE TABLE novels (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL, genre TEXT NOT NULL DEFAULT '', style TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'draft', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)")
      database.run("INSERT INTO novels (slug, title, created_at, updated_at) VALUES ('old-book', '旧书', '2026-01-01', '2026-01-01')")
      initializeCatalogSchema(database)
      const novel = database.query('SELECT slug, title, description, logline, target_words, themes FROM novels WHERE slug = ?').get('old-book') as Record<string, unknown>
      expect(novel.slug).toBe('old-book')
      expect(novel.description).toBe('')
      expect(novel.logline).toBe('')
      expect(novel.target_words).toBe(0)
      expect(novel.themes).toBe('[]')
    } finally {
      database.close()
    }
  })

  test('主题字段接受 JSON 数组', () => {
    const database = new Database(':memory:')
    try {
      initializeCatalogSchema(database)
      // 与仓库里其它地方一致：用 query(...).run(参数) 这一形态传参
      database.query("INSERT INTO novels (slug, title, themes) VALUES ('xuanhuan', '玄幻', ?)").run(JSON.stringify(['玄幻', '成长']))
      expect(database.query('SELECT json_valid(themes) AS valid FROM novels WHERE slug = ?').get('xuanhuan')).toEqual({ valid: 1 })
    } finally {
      database.close()
    }
  })
})

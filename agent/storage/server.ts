import { openCatalogDatabase, openNovelDatabase } from './novelDatabase'
import { createMemoryStore, type MemoryRecord } from './memoryStore'
import { createSiliconFlowEmbeddingClient } from './embedding'

type Novel = { id: number; slug: string; title: string; genre: string; style: string; status: string; created_at: string; updated_at: string }
const json = (body: unknown, status = 200): Response => Response.json(body, { status, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS' } })
const bad = (message: string, status = 400) => json({ message }, status)
const catalogNovel = (id: number): Novel | null => { const database = openCatalogDatabase(); try { return database.query('SELECT * FROM novels WHERE id = ?').get(id) as Novel | null } finally { database.close() } }
const listNovels = (): Novel[] => { const database = openCatalogDatabase(); try { return database.query('SELECT * FROM novels ORDER BY updated_at DESC, id DESC').all() as Novel[] } finally { database.close() } }
const embeddingClient = createSiliconFlowEmbeddingClient()
const embedOrUndefined = async (input: string): Promise<number[] | undefined> => { try { return (await embeddingClient.embed([input]))[0] } catch (error) { console.warn(error instanceof Error ? error.message : error); return undefined } }

const server = Bun.serve({
  port: 3000,
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS' } })
    const url = new URL(request.url); const parts = url.pathname.split('/').filter(Boolean)
    try {
      if (url.pathname === '/api/health') return json({ ok: true, storage: 'catalog + per-novel sqlite' })
      if (url.pathname === '/api/novels' && request.method === 'GET') return json(listNovels())
      if (url.pathname === '/api/novels' && request.method === 'POST') {
        const body = await request.json() as Partial<Novel>
        if (!body.slug || !body.title || !/^[a-z0-9][a-z0-9-]{0,47}$/.test(body.slug)) return bad('slug 必须是小写字母、数字或连字符')
        const catalog = openCatalogDatabase()
        try { const result = catalog.query('INSERT INTO novels (slug, title, genre, style, status) VALUES (?, ?, ?, ?, ?)').run(body.slug, body.title, body.genre ?? '', body.style ?? '', body.status ?? 'draft'); const novel = catalog.query('SELECT * FROM novels WHERE id = ?').get(Number(result.lastInsertRowid)) as Novel; openNovelDatabase(novel.slug).close(); return json(novel, 201) } finally { catalog.close() }
      }
      if (parts[0] === 'api' && parts[1] === 'novels' && parts[2] && parts[3] === 'chapters' && request.method === 'GET') {
        const novel = catalogNovel(Number(parts[2])); if (!novel) return bad('小说不存在', 404); const database = openNovelDatabase(novel.slug)
        try { return json(database.query(`SELECT c.id, c.idx, c.title, c.volume_id, c.goal, c.conflict, c.hook, c.emotion, c.summary, coalesce((SELECT t.stage FROM chapter_texts t WHERE t.chapter_id = c.id AND t.stage = 'final'), (SELECT t.stage FROM chapter_texts t WHERE t.chapter_id = c.id AND t.stage = 'draft'), 'none') AS textStage FROM chapters c ORDER BY c.idx`).all()) } finally { database.close() }
      }
      if (parts[0] === 'api' && parts[1] === 'novels' && parts[2] && !parts[3] && request.method === 'GET') { const novel = catalogNovel(Number(parts[2])); return novel ? json(novel) : bad('小说不存在', 404) }
      if (parts[0] === 'api' && parts[1] === 'chapters' && parts[2] && parts[3] === 'text') {
        const chapterId = Number(parts[2]); const stage = url.searchParams.get('stage') ?? 'draft'
        for (const novel of listNovels()) { const database = openNovelDatabase(novel.slug); try { if (!database.query('SELECT id FROM chapters WHERE id = ?').get(chapterId)) continue; if (request.method === 'GET') return json(database.query('SELECT * FROM chapter_texts WHERE chapter_id = ? AND stage = ?').get(chapterId, stage) ?? { chapter_id: chapterId, stage, text: '' }); if (request.method === 'PUT') { const body = await request.json() as { text?: string; summary?: string; ends_with?: string }; database.query(`INSERT INTO chapter_texts (chapter_id, stage, text, summary, ends_with) VALUES (?, ?, ?, ?, ?) ON CONFLICT(chapter_id, stage) DO UPDATE SET text=excluded.text, summary=excluded.summary, ends_with=excluded.ends_with, updated_at=datetime('now','localtime')`).run(chapterId, stage, body.text ?? '', body.summary ?? '', body.ends_with ?? ''); return json(database.query('SELECT * FROM chapter_texts WHERE chapter_id = ? AND stage = ?').get(chapterId, stage)) } } finally { database.close() } }
        return bad('章节不存在', 404)
      }
      if (parts[0] === 'api' && parts[1] === 'novels' && parts[2] && parts[3] === 'memories') {
        const novel = catalogNovel(Number(parts[2])); if (!novel) return bad('小说不存在', 404)
        const database = openNovelDatabase(novel.slug)
        try {
          const store = createMemoryStore(database)
          if (request.method === 'POST') {
            const body = await request.json() as MemoryRecord
            if (!body.layer || !body.title || !body.content || !body.sourceType || !body.sourceId) return bad('记忆条目缺少 layer、title、content、sourceType 或 sourceId')
            const embedding = body.embedding ?? await embedOrUndefined(`${body.title}\n${body.content}`)
            return json(store.upsert({ ...body, novelId: novel.slug, embedding }), 201)
          }
          if (request.method === 'GET') {
            const query = url.searchParams.get('q') ?? ''
            if (!query.trim()) return bad('缺少查询参数 q')
            const parseOptionalNumber = (value: string | null): number | undefined => value == null ? undefined : Number(value)
            const embedding = await embedOrUndefined(query)
            return json(store.search({ novelId: novel.slug, query, volumeId: parseOptionalNumber(url.searchParams.get('volumeId')), chapterId: parseOptionalNumber(url.searchParams.get('chapterId')), embedding, limit: Number(url.searchParams.get('limit') ?? 10) }))
          }
        } finally { database.close() }
      }
      return bad('接口不存在', 404)
    } catch (error) { return bad(error instanceof Error ? error.message : '服务器错误', 500) }
  },
})
console.log(`墨灵 API 已启动：http://localhost:${server.port}`)

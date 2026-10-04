import type { Database } from 'bun:sqlite'

export type MemoryLayer = 'raw' | 'fact' | 'scene' | 'world' | 'character' | 'plot' | 'chapter'
export type MemoryRecord = {
  novelId: string
  layer: MemoryLayer
  title: string
  content: string
  sourceType: string
  sourceId: string
  volumeId?: number
  chapterId?: number
  metadata?: Record<string, unknown>
  embedding?: number[]
}
export type MemorySearchOptions = { novelId: string; query: string; layer?: MemoryLayer; volumeId?: number; chapterId?: number; embedding?: number[]; limit?: number }
export type MemorySearchResult = MemoryRecord & { id: number; match: 'keyword' | 'vector' | 'hybrid'; score: number }

const tokenize = (value: string): string[] => {
  const tokens = value.match(/[\p{Script=Han}]|[\p{L}\p{N}_]+/gu) ?? []
  return [...new Set(tokens.filter((token) => token.trim()))]
}
const ftsText = (value: string): string => tokenize(value).join(' ')
const quoteFts = (value: string): string => tokenize(value).map((token) => `"${token.replaceAll('"', '')}"`).join(' OR ')
const cosine = (left: number[], right: number[]): number => {
  if (left.length === 0 || left.length !== right.length) return 0
  let dot = 0; let leftNorm = 0; let rightNorm = 0
  for (let index = 0; index < left.length; index += 1) { const a = left[index] ?? 0; const b = right[index] ?? 0; dot += a * b; leftNorm += a * a; rightNorm += b * b }
  return leftNorm && rightNorm ? dot / Math.sqrt(leftNorm * rightNorm) : 0
}

export const createMemoryStore = (database: Database) => ({
  upsert(record: MemoryRecord): number {
    const existing = database.query('SELECT id FROM memory_items WHERE novel_id = ? AND source_type = ? AND source_id = ?').get(record.novelId, record.sourceType, record.sourceId) as { id: number } | null
    database.query(`INSERT INTO memory_items (novel_id, layer, title, content, source_type, source_id, volume_id, chapter_id, metadata, embedding) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(novel_id, source_type, source_id) DO UPDATE SET layer=excluded.layer, title=excluded.title, content=excluded.content, volume_id=excluded.volume_id, chapter_id=excluded.chapter_id, metadata=excluded.metadata, embedding=excluded.embedding, updated_at=datetime('now','localtime')`).run(record.novelId, record.layer, record.title, record.content, record.sourceType, record.sourceId, record.volumeId ?? null, record.chapterId ?? null, JSON.stringify(record.metadata ?? {}), record.embedding ? JSON.stringify(record.embedding) : null)
    const row = database.query('SELECT id FROM memory_items WHERE novel_id = ? AND source_type = ? AND source_id = ?').get(record.novelId, record.sourceType, record.sourceId) as { id: number }
    if (existing) database.query('DELETE FROM memory_items_fts WHERE rowid = ?').run(existing.id)
    database.query('INSERT INTO memory_items_fts (rowid, title, content) VALUES (?, ?, ?)').run(row.id, ftsText(record.title), ftsText(record.content))
    return row.id
  },
  search(options: MemorySearchOptions): MemorySearchResult[] {
    const limit = Math.max(1, Math.min(options.limit ?? 10, 100))
    const filters = ['m.novel_id = ?']; const params: Array<string | number> = [options.novelId]
    if (options.layer !== undefined) { filters.push('m.layer = ?'); params.push(options.layer) }
    if (options.volumeId !== undefined) { filters.push('m.volume_id = ?'); params.push(options.volumeId) }
    if (options.chapterId !== undefined) { filters.push('m.chapter_id = ?'); params.push(options.chapterId) }
    const where = filters.join(' AND ')
    const keyword = quoteFts(options.query)
    const keywordRows = keyword ? database.query(`SELECT m.* FROM memory_items_fts f JOIN memory_items m ON m.id = f.rowid WHERE f.memory_items_fts MATCH ? AND ${where} LIMIT ?`).all(keyword, ...params, limit) as Array<Record<string, unknown>> : []
    const keywordResults = keywordRows.map((row, index) => toResult(row, 'keyword', 1 / (index + 1)))
    if (!options.embedding) return keywordResults
    const vectorRows = database.query(`SELECT * FROM memory_items m WHERE ${where} AND m.embedding IS NOT NULL`).all(...params) as Array<Record<string, unknown>>
    const vectorResults = vectorRows.map((row) => toResult(row, 'vector', cosine(options.embedding ?? [], JSON.parse(String(row.embedding)) as number[]))).sort((a, b) => b.score - a.score).slice(0, limit)
    const merged = new Map<number, MemorySearchResult>()
    for (const [index, result] of keywordResults.entries()) merged.set(result.id, { ...result, score: result.score * 0.35 })
    for (const [index, result] of vectorResults.entries()) {
      const previous = merged.get(result.id)
      merged.set(result.id, previous ? { ...result, match: 'hybrid', score: previous.score + result.score * 0.65 } : { ...result, score: result.score * 0.65 })
    }
    return [...merged.values()].sort((a, b) => b.score - a.score).slice(0, limit)
  },
})

const toResult = (row: Record<string, unknown>, match: 'keyword' | 'vector' | 'hybrid', score: number): MemorySearchResult => ({ id: Number(row.id), novelId: String(row.novel_id), layer: row.layer as MemoryLayer, title: String(row.title), content: String(row.content), sourceType: String(row.source_type), sourceId: String(row.source_id), volumeId: row.volume_id == null ? undefined : Number(row.volume_id), chapterId: row.chapter_id == null ? undefined : Number(row.chapter_id), metadata: JSON.parse(String(row.metadata ?? '{}')) as Record<string, unknown>, embedding: row.embedding ? JSON.parse(String(row.embedding)) as number[] : undefined, match, score })

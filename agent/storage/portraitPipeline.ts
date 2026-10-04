import type { Database } from 'bun:sqlite'
import type { EmbeddingClient } from './embedding'
import { createMemoryStore, type MemoryRecord } from './memoryStore'

export type L0Event = Omit<MemoryRecord, 'layer' | 'embedding'> & { characterId?: number; confidence?: number }
export type L1Fact = L0Event & { confidence: number }
export type PortraitUpdate = { novelId: string; characterId: number; profile: string; tags: string[]; basedOnFactIds: number[] }
export type Portrait = { id: number; novelId: string; characterId: number; version: number; profile: string; tags: string[]; basedOnFactIds: number[]; updatedAt: string }

type PortraitPipelineOptions = { embed: EmbeddingClient['embed']; maxAttempts?: number }

const recordFor = (record: L0Event | L1Fact, layer: 'raw' | 'fact', embedding?: number[]): MemoryRecord => ({
  novelId: record.novelId,
  layer,
  title: record.title,
  content: record.content,
  sourceType: layer === 'raw' ? `l0:${record.sourceType}` : `l1:${record.sourceType}`,
  sourceId: `${layer}:${record.sourceId}`,
  volumeId: record.volumeId,
  chapterId: record.chapterId,
  metadata: { characterId: record.characterId, confidence: record.confidence },
  embedding,
})

export const createPortraitPipeline = (database: Database, options: PortraitPipelineOptions) => {
  const store = createMemoryStore(database)
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3)
  const recordWithEmbedding = async (record: MemoryRecord): Promise<{ id: number; embeddingPending: boolean }> => {
    let embedding: number[] | undefined
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try { embedding = (await options.embed([`${record.title}\n${record.content}`]))[0]; break } catch { /* keep the source record even when provider is unavailable */ }
    }
    return { id: store.upsert({ ...record, embedding }), embeddingPending: !embedding }
  }
  return {
    async recordEvent(event: L0Event): Promise<{ id: number; embeddingPending: boolean }> { return recordWithEmbedding(recordFor(event, 'raw')) },
    async recordFact(fact: L1Fact): Promise<{ id: number; embeddingPending: boolean }> { return recordWithEmbedding(recordFor(fact, 'fact')) },
    async updatePortrait(update: PortraitUpdate): Promise<{ memoryId: number; embeddingPending: boolean }> {
      const existing = database.query('SELECT version FROM character_portraits WHERE novel_id = ? AND character_id = ? ORDER BY version DESC LIMIT 1').get(update.novelId, update.characterId) as { version: number } | null
      const version = (existing?.version ?? 0) + 1
      const now = new Date().toISOString()
      database.query(`INSERT INTO character_portraits (novel_id, character_id, version, profile, tags, based_on_fact_ids, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(update.novelId, update.characterId, version, update.profile, JSON.stringify(update.tags), JSON.stringify(update.basedOnFactIds), now)
      const result = await recordWithEmbedding({ novelId: update.novelId, stage: 'L3', layer: 'scene', title: `角色画像:${update.characterId}:v${version}`, content: update.profile, sourceType: 'portrait', sourceId: `character:${update.characterId}:v${version}`, metadata: { characterId: update.characterId, version, tags: update.tags, basedOnFactIds: update.basedOnFactIds } })
      database.query('UPDATE character_portraits SET memory_id = ? WHERE novel_id = ? AND character_id = ? AND version = ?').run(result.id, update.novelId, update.characterId, version)
      return { memoryId: result.id, embeddingPending: result.embeddingPending }
    },
    getPortrait(novelId: string, characterId: number): Portrait | null {
      const row = database.query('SELECT * FROM character_portraits WHERE novel_id = ? AND character_id = ? ORDER BY version DESC LIMIT 1').get(novelId, characterId) as Record<string, unknown> | null
      if (!row) return null
      return { id: Number(row.id), novelId: String(row.novel_id), characterId: Number(row.character_id), version: Number(row.version), profile: String(row.profile), tags: JSON.parse(String(row.tags)) as string[], basedOnFactIds: JSON.parse(String(row.based_on_fact_ids)) as number[], updatedAt: String(row.updated_at) }
    },
  }
}

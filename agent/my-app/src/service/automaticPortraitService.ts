import type { Database } from 'bun:sqlite'
import type { EmbeddingClient } from '../shared/embedding'
import { createPortraitPipeline, type L1Fact } from './portraitService'

type PortraitModel = { invoke(input: string): Promise<unknown> }
type PortraitResponse = { profile?: unknown; tags?: unknown }

const contentOf = (response: unknown): string => {
  if (typeof response === 'string') return response
  if (response && typeof response === 'object' && 'content' in response) return String((response as { content: unknown }).content)
  return String(response ?? '')
}

const parseResponse = (raw: string): { profile: string; tags: string[] } | null => {
  const match = raw.match(/\{[\s\S]*\}/)
  if (!match) return null
  try {
    const value = JSON.parse(match[0]) as PortraitResponse
    const profile = typeof value.profile === 'string' ? value.profile.trim() : ''
    const tags = Array.isArray(value.tags) ? value.tags.filter((tag): tag is string => typeof tag === 'string' && tag.trim().length > 0).map((tag) => tag.trim()).slice(0, 12) : []
    return profile ? { profile, tags } : null
  } catch { return null }
}

const portraitPrompt = (characterId: number, previous: string, facts: Array<{ title: string; content: string; category: unknown }>): string => `你是中文小说的动态角色画像整理器。
请根据角色 ${characterId} 最近已经确认的 L1 原子事实，整理当前画像。只总结已经发生的状态、关系、目标和变化，不要虚构，不要保留过程解释。
输出严格 JSON：{"profile":"一段简洁的当前画像","tags":["不超过12个状态标签"]}
上一版画像：${previous || '暂无，这是角色的第一版动态画像。'}
事实：
${facts.map((fact) => `- [${String(fact.category ?? 'fact')}] ${fact.title}：${fact.content}`).join('\n')}`

export const createAutomaticPortraitUpdater = (model: PortraitModel, database: Database, novelId: string, options: { embed: EmbeddingClient['embed'] }) => {
  const pipeline = createPortraitPipeline(database, options)
  return async (factIds: number[]): Promise<number[]> => {
    if (factIds.length === 0) return []
    const placeholders = factIds.map(() => '?').join(',')
    const rows = database.query(`SELECT id, metadata, title, content FROM memory_items WHERE id IN (${placeholders}) AND stage = 'L1'`).all(...factIds) as Array<{ id: number; metadata: string; title: string; content: string }>
    const byCharacter = new Map<number, typeof rows>()
    for (const row of rows) {
      const metadata = JSON.parse(row.metadata || '{}') as { characterId?: number; category?: string }
      if (!Number.isInteger(metadata.characterId)) continue
      const current = byCharacter.get(metadata.characterId) ?? []
      current.push({ ...row, metadata: JSON.stringify(metadata) })
      byCharacter.set(metadata.characterId, current)
    }
    const updated: number[] = []
    for (const [characterId, characterRows] of byCharacter) {
      const facts = characterRows.map((row) => {
        const metadata = JSON.parse(row.metadata) as { category?: string }
        return { title: row.title, content: row.content, category: metadata.category }
      })
      const previous = database.query('SELECT profile FROM character_portraits WHERE novel_id = ? AND character_id = ? ORDER BY version DESC LIMIT 1').get(novelId, characterId) as { profile: string } | null
      const result = parseResponse(contentOf(await model.invoke(portraitPrompt(characterId, previous?.profile ?? '', facts))))
      if (!result) continue
      await pipeline.updatePortrait({ novelId, characterId, profile: result.profile, tags: result.tags, basedOnFactIds: characterRows.map((row) => row.id) })
      updated.push(characterId)
    }
    return updated
  }
}

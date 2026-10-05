import { createSiliconFlowEmbeddingClient } from './embedding'
import { createMemoryAutomation } from './memoryAutomation'
import { openCatalogDatabase, openNovelDatabase } from './novelDatabase'
import type { L0Event } from './portraitPipeline'

export const captureNovelEvent = async (novelId: number, event: Omit<L0Event, 'novelId'>): Promise<void> => {
  const catalog = openCatalogDatabase()
  try {
    const novel = catalog.query('SELECT slug FROM novels WHERE id = ?').get(novelId) as { slug: string } | null
    if (!novel) return
    const database = openNovelDatabase(novel.slug)
    try { await createMemoryAutomation(database, createSiliconFlowEmbeddingClient()).capture({ ...event, novelId: novel.slug }) } finally { database.close() }
  } finally { catalog.close() }
}

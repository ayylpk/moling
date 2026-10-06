import { createSiliconFlowEmbeddingClient } from '../shared/embedding'
import { createMemoryAutomation } from './memoryAutomation'
import { createNovelL1Extractor } from './l1Extractor'
import { createAutomaticPortraitUpdater } from './automaticPortraitService'
import { openCatalogDatabase, openNovelDatabase } from '../db/connection'
import type { L0Event } from './portraitService'
import { createModel } from '../../../create_model'

export const captureNovelEvent = async (novelId: number, event: Omit<L0Event, 'novelId'>): Promise<void> => {
  const catalog = openCatalogDatabase()
  try {
    const novel = catalog.query('SELECT slug FROM novels WHERE id = ?').get(novelId) as { slug: string } | null
    if (!novel) return
    const database = openNovelDatabase(novel.slug)
    try {
      const automation = createMemoryAutomation(database, createSiliconFlowEmbeddingClient())
      await automation.capture({ ...event, novelId: novel.slug })
      const modelKey = process.env.DEEPSEEK_API_KEY ?? process.env.ANTHROPIC_AUTH_TOKEN ?? process.env.API_KEY
      if (modelKey && process.env.MEMORY_AUTO_L1 !== 'false') {
        const extractor = createNovelL1Extractor(createModel(0.1))
        const updatePortrait = createAutomaticPortraitUpdater(createModel(0.1), database, novel.slug, createSiliconFlowEmbeddingClient())
        for (let index = 0; index < 20 && automation.pending() > 0; index += 1) {
          const result = await automation.processNext(extractor, async (_facts, factIds) => { await updatePortrait(factIds) })
          if (result.status === 'empty' || result.status === 'failed') break
        }
      }
    } finally { database.close() }
  } finally { catalog.close() }
}

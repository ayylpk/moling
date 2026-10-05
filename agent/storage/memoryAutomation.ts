import type { Database } from 'bun:sqlite'
import type { EmbeddingClient } from './embedding'
import { createPortraitPipeline, type L0Event, type L1Fact } from './portraitPipeline'

type AutomationOptions = { embed: EmbeddingClient['embed']; maxAttempts?: number }
type FactExtractor = (event: L0Event) => Promise<L1Fact[]>
type JobRow = { id: number; payload: string; attempts: number }

export const createMemoryAutomation = (database: Database, options: AutomationOptions) => {
  const pipeline = createPortraitPipeline(database, options)
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3)

  return {
    async capture(event: L0Event) {
      const result = await pipeline.recordEvent(event)
      const payload = JSON.stringify(event)
      database.query(`INSERT INTO memory_jobs (memory_id, novel_id, payload, status) VALUES (?, ?, ?, 'pending') ON CONFLICT(memory_id) DO UPDATE SET payload=excluded.payload, status='pending', error='', updated_at=datetime('now','localtime')`).run(result.id, event.novelId, payload)
      return { ...result, stage: 'L0' as const, jobId: Number((database.query('SELECT id FROM memory_jobs WHERE memory_id = ?').get(result.id) as { id: number }).id) }
    },
    pending(): number {
      return Number((database.query("SELECT count(*) AS count FROM memory_jobs WHERE status = 'pending'").get() as { count: number }).count)
    },
    async processNext(extract: FactExtractor): Promise<{ status: 'done' | 'retry' | 'failed' | 'empty'; factIds: number[]; error?: string }> {
      const job = database.query("SELECT id, payload, attempts FROM memory_jobs WHERE status = 'pending' ORDER BY id LIMIT 1").get() as JobRow | null
      if (!job) return { status: 'empty', factIds: [] }
      database.query("UPDATE memory_jobs SET status='running', updated_at=datetime('now','localtime') WHERE id = ?").run(job.id)
      const event = JSON.parse(job.payload) as L0Event
      try {
        const facts = await extract(event)
        const factIds: number[] = []
        for (const fact of facts) factIds.push((await pipeline.recordFact(fact)).id)
        database.query("UPDATE memory_jobs SET status='done', attempts=attempts + 1, error='', updated_at=datetime('now','localtime') WHERE id = ?").run(job.id)
        return { status: 'done', factIds }
      } catch (error) {
        const attempts = job.attempts + 1
        const status = attempts >= maxAttempts ? 'failed' : 'pending'
        const message = error instanceof Error ? error.message : String(error)
        database.query("UPDATE memory_jobs SET status=?, attempts=?, error=?, updated_at=datetime('now','localtime') WHERE id = ?").run(status, attempts, message, job.id)
        return { status: status === 'pending' ? 'retry' : 'failed', factIds: [], error: message }
      }
    },
  }
}

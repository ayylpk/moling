import type { Database } from 'bun:sqlite'

export type ChapterStage = 'world' | 'character' | 'location' | 'outline' | 'chapter' | 'polish'
export type TextStage = 'draft' | 'final'
export type ChapterOutline = {
  id: number
  idx: number
  title: string
  goal: string
  conflict: string
  hook: string
  emotion: string
  summary: string
  placeRaw: string
  wordCountTarget: number
}
export type ChapterText = {
  id: number
  chapterId: number
  stage: TextStage
  text: string
  summary: string
  endsWith: string
  polishReport: unknown
}
export type GenerationTask = {
  id: number
  stage: ChapterStage
  targetKey: string
  status: 'pending' | 'running' | 'done' | 'failed' | 'stale'
  attempt: number
  inputHash: string
  error: string
}

type TaskRow = {
  id: number
  stage: ChapterStage
  target_key: string
  status: GenerationTask['status']
  attempt: number
  input_hash: string
  error: string
}

export const createChapterRuntime = (database: Database) => {
  const readTask = (id: number): GenerationTask | null => {
    const row = database.query('SELECT id, stage, target_key, status, attempt, input_hash, error FROM generation_tasks WHERE id = ?').get(id) as TaskRow | null
    return row ? toTask(row) : null
  }

  const readTaskByKey = (stage: ChapterStage, targetKey: string): GenerationTask | null => {
    const row = database.query('SELECT id, stage, target_key, status, attempt, input_hash, error FROM generation_tasks WHERE stage = ? AND target_key = ?').get(stage, targetKey) as TaskRow | null
    return row ? toTask(row) : null
  }

  return {
    getChapter(idx: number): ChapterOutline | null {
      const row = database.query('SELECT id, idx, title, goal, conflict, hook, emotion, summary, place_raw, word_count_target FROM chapters WHERE idx = ?').get(idx) as Record<string, unknown> | null
      return row ? {
        id: Number(row.id), idx: Number(row.idx), title: String(row.title), goal: String(row.goal), conflict: String(row.conflict), hook: String(row.hook),
        emotion: String(row.emotion), summary: String(row.summary), placeRaw: String(row.place_raw), wordCountTarget: Number(row.word_count_target),
      } : null
    },
    getText(chapterIdx: number, stage: TextStage): ChapterText | null {
      const chapter = this.getChapter(chapterIdx)
      if (!chapter) return null
      const row = database.query('SELECT id, chapter_id, stage, text, summary, ends_with, polish_report FROM chapter_texts WHERE chapter_id = ? AND stage = ?').get(chapter.id, stage) as Record<string, unknown> | null
      return row ? {
        id: Number(row.id), chapterId: Number(row.chapter_id), stage: row.stage as TextStage, text: String(row.text), summary: String(row.summary), endsWith: String(row.ends_with), polishReport: JSON.parse(String(row.polish_report || '[]')),
      } : null
    },
    saveText(chapterIdx: number, input: { stage: TextStage; text: string; summary?: string; endsWith?: string; polishReport?: unknown }): ChapterText {
      const chapter = this.getChapter(chapterIdx)
      if (!chapter) throw new Error(`找不到第 ${chapterIdx} 章`)
      database.query(`INSERT INTO chapter_texts (chapter_id, stage, text, summary, ends_with, polish_report) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(chapter_id, stage) DO UPDATE SET text=excluded.text, summary=excluded.summary, ends_with=excluded.ends_with, polish_report=excluded.polish_report, updated_at=datetime('now','localtime')`).run(chapter.id, input.stage, input.text, input.summary ?? '', input.endsWith ?? '', JSON.stringify(input.polishReport ?? []))
      return this.getText(chapterIdx, input.stage)!
    },
    planTask(stage: ChapterStage, targetKey: string, inputHash = ''): GenerationTask {
      const existing = readTaskByKey(stage, targetKey)
      if (!existing) {
        const result = database.query('INSERT INTO generation_tasks (stage, target_key, input_hash) VALUES (?, ?, ?)').run(stage, targetKey, inputHash)
        return readTask(Number(result.lastInsertRowid))!
      }
      if (inputHash && inputHash !== existing.inputHash) {
        database.query("UPDATE generation_tasks SET input_hash = ?, status = 'pending', error = '', updated_at = datetime('now','localtime') WHERE id = ?").run(inputHash, existing.id)
      }
      return readTask(existing.id)!
    },
    claimTask(stage: ChapterStage, targetKey: string, inputHash = ''): { action: 'run' | 'skip'; taskId: number; task: GenerationTask } {
      const task = this.planTask(stage, targetKey, inputHash)
      if (task.status === 'done' && inputHash && task.inputHash === inputHash) return { action: 'skip', taskId: task.id, task }
      database.query("UPDATE generation_tasks SET status = 'running', attempt = attempt + 1, started_at = datetime('now','localtime'), updated_at = datetime('now','localtime') WHERE id = ?").run(task.id)
      const claimed = readTask(task.id)!
      return { action: 'run', taskId: claimed.id, task: claimed }
    },
    finishTask(taskId: number, artifactPath = ''): GenerationTask {
      database.query("UPDATE generation_tasks SET status = 'done', artifact_path = ?, finished_at = datetime('now','localtime'), error = '', updated_at = datetime('now','localtime') WHERE id = ?").run(artifactPath, taskId)
      return readTask(taskId)!
    },
    failTask(taskId: number, error: string): GenerationTask {
      database.query("UPDATE generation_tasks SET status = 'failed', error = ?, updated_at = datetime('now','localtime') WHERE id = ?").run(error.slice(0, 2000), taskId)
      return readTask(taskId)!
    },
    getTask: readTask,
  }
}

const toTask = (row: TaskRow): GenerationTask => ({ id: Number(row.id), stage: row.stage, targetKey: String(row.target_key), status: row.status, attempt: Number(row.attempt), inputHash: String(row.input_hash), error: String(row.error) })

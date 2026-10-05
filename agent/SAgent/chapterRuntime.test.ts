import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { initializeNovelSchema } from '../storage/novelDatabase'
import { createChapterRuntime } from './chapterRuntime'

const setup = () => {
  const database = new Database(':memory:')
  initializeNovelSchema(database)
  database.query(`INSERT INTO volumes (no, name, start_chapter, end_chapter) VALUES (1, '第一卷', 1, 3)`).run()
  database.query(`INSERT INTO chapters (volume_id, idx, title, goal, conflict, hook) VALUES (1, 1, '雨夜', '找到线索', '线索即将消失', '门后有人')`).run()
  return database
}

describe('center chapter sqlite runtime', () => {
  test('reads outlines, saves draft/final text, and reuses completed tasks', () => {
    const database = setup()
    const runtime = createChapterRuntime(database)
    expect(runtime.getChapter(1)).toMatchObject({ idx: 1, title: '雨夜', goal: '找到线索' })

    const planned = runtime.planTask('chapter', '1', 'outline-v1')
    expect(planned.status).toBe('pending')
    const claimed = runtime.claimTask('chapter', '1', 'outline-v1')
    expect(claimed.action).toBe('run')

    runtime.saveText(1, { stage: 'draft', text: '初稿', summary: '找到线索。', endsWith: '门后有人。' })
    runtime.saveText(1, { stage: 'final', text: '终稿', summary: '找到线索。', endsWith: '门后有人。', polishReport: [{ kind: '节奏' }] })
    runtime.finishTask(claimed.taskId)

    expect(runtime.getText(1, 'final')).toMatchObject({ text: '终稿', summary: '找到线索。' })
    expect(runtime.claimTask('chapter', '1', 'outline-v1')).toMatchObject({ action: 'skip', taskId: claimed.taskId })
    database.close()
  })

  test('records failure and allows a later retry', () => {
    const database = setup()
    const runtime = createChapterRuntime(database)
    runtime.planTask('chapter', '1')
    const claimed = runtime.claimTask('chapter', '1')
    runtime.failTask(claimed.taskId, '执笔模型超时')

    expect(runtime.getTask(claimed.taskId)).toMatchObject({ status: 'failed', error: '执笔模型超时' })
    expect(runtime.claimTask('chapter', '1')).toMatchObject({ action: 'run', taskId: claimed.taskId })
    database.close()
  })
})

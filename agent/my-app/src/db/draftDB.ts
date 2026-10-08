import type { Database } from 'bun:sqlite'

/**
 * 草案 db 层 —— 待审核草案的**唯一**存储点。
 *
 * ── 它是什么 ──
 * 生成类动作（中心 Agent 的 generate_* 工具、HTTP 草案生成接口）把产出先写进 drafts 表，
 * 作者采纳后才由 draftService 把内容写进正式表并清掉草案。重新生成 = 同一个
 * (stage, target_key) 上的 upsert，只覆盖草案，不碰正式表。
 *
 * ── 为什么放 per-novel 库 ──
 * 一本一个库天然隔离了草案：跨书不可能串（连"挨本找"的机会都没有）。
 * 页面刷新后前端从 GET /drafts 重读，草案不靠前端内存活着。
 */

export type DraftStage = 'world' | 'cast' | 'volume_outline' | 'prose' | 'decision'

export type Draft = {
  stage: DraftStage
  targetKey: string
  content: string
  createdAt: string
  updatedAt: string
}

const parseContent = (value: unknown): unknown => {
  try { return JSON.parse(String(value ?? '')) } catch { return String(value ?? '') }
}

export const createDraftRuntime = (database: Database) => {
  const toDraft = (row: Record<string, unknown>): Draft => ({
    stage: String(row.stage) as DraftStage,
    targetKey: String(row.target_key ?? ''),
    content: String(row.content ?? ''),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  })

  return {
    /** 取一条草案；没有返回 null。 */
    get(stage: DraftStage, targetKey = ''): Draft | null {
      const row = database
        .query('SELECT * FROM drafts WHERE stage = ? AND target_key = ?')
        .get(stage, targetKey) as Record<string, unknown> | null
      return row ? toDraft(row) : null
    },

    /** 取一条草案并把 content 解析成对象；解析失败原样给字符串。 */
    getParsed(stage: DraftStage, targetKey = ''): unknown | null {
      const draft = this.get(stage, targetKey)
      return draft ? parseContent(draft.content) : null
    },

    /** 有没有待审核草案（闸门用它判断"能不能采纳"）。 */
    has(stage: DraftStage, targetKey = ''): boolean {
      return this.get(stage, targetKey) !== null
    },

    /** 覆盖式写入。重新生成只替换草案，不影响已保存内容。 */
    put(stage: DraftStage, targetKey: string, content: string): Draft {
      database
        .query(
          `INSERT INTO drafts (stage, target_key, content) VALUES (?, ?, ?)
           ON CONFLICT(stage, target_key) DO UPDATE SET content = excluded.content, updated_at = datetime('now','localtime')`,
        )
        .run(stage, targetKey, content)
      return this.get(stage, targetKey)!
    },

    /** 列出待审核草案；给 stage 就只列这个阶段的。按更新时间倒序。 */
    list(stage?: DraftStage): Draft[] {
      const rows = stage
        ? (database.query('SELECT * FROM drafts WHERE stage = ? ORDER BY updated_at DESC').all(stage) as Array<Record<string, unknown>>)
        : (database.query('SELECT * FROM drafts ORDER BY updated_at DESC').all() as Array<Record<string, unknown>>)
      return rows.map(toDraft)
    },

    /** 清掉草案（采纳成功或作者放弃后）。返回删掉的条数。 */
    clear(stage: DraftStage, targetKey?: string): number {
      if (targetKey === undefined) {
        return Number(database.query('DELETE FROM drafts WHERE stage = ?').run(stage).changes)
      }
      return Number(
        database.query('DELETE FROM drafts WHERE stage = ? AND target_key = ?').run(stage, targetKey).changes,
      )
    },
  }
}

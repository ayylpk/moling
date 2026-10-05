/**
 * 工作流灯位状态 —— 执笔画布那七盏灯读的就是这里。
 *
 * 数据源全在**每本小说自己的库**（`resources/novels/<slug>/novel.sqlite`），不新增任何表：
 *
 *   界 / 色 / 景 / 纲 / 章   五盏  ← `generation_tasks`（按 stage 聚合）
 *   写 / 润              两盏  ← `chapter_texts`（有初稿几章 / 定稿几章）
 *
 * 为什么"写、润"不也用 generation_tasks：
 *   generation_tasks 是**任务登记簿**（断点续跑用），章纲任务和正文任务都记在 stage='chapter' 下，
 *   分不出"写"和"润"。而 chapter_texts 是**真产物**（draft/final 两行封顶），
 *   "几章写了初稿、几章定了稿"只能从它算 —— 这才是页面要说的那句话。
 *
 * 一盏灯只有四种脸色（与前端 CSS 的 is-{state} 一一对应）：
 *   有在跑 → running ｜ 有折的 → failed ｜ 该阶段全成 → done ｜ 其余 → idle
 * 注意 running 和 failed 优先于 done：跑着的时候不能说"已成"。
 *
 * 这里**不编造**任何数字。没有数据源的字段（例如"本轮 token 用量"）干脆不返回，
 * 页面也不画 —— 摆一个假数比空着更糟。
 */
import type { Database } from 'bun:sqlite'

export type LampState = 'done' | 'running' | 'idle' | 'failed'

export type WorkflowNode = {
  id: string
  name: string
  mark: string
  /** generation_tasks 的 stage；"写/润"两盏复用的是 chapter */
  stage: string
  state: LampState
  total: number
  done: number
  running: number
  failed: number
  /** 正在做的那一项（running 优先，其次 pending）。没有就是空串 */
  current: string
  /** 浮签上那行"真话"，例如 "3/50 已成 · 1 在写" */
  summary: string
  /** 最近一次变动时间；从没动过就是空串 */
  updated_at: string
}

export type WorkflowHub = {
  state: LampState
  current: string
  summary: string
  updated_at: string
}

export type WorkflowStatus = {
  nodes: WorkflowNode[]
  hub: WorkflowHub
}

/** 五盏走任务簿的灯。顺序即画布上的职别顺序 */
const TASK_LAMPS = [
  { id: 'world', name: '设定', mark: '界', stage: 'world' },
  { id: 'character', name: '角色', mark: '色', stage: 'character' },
  { id: 'location', name: '场景', mark: '景', stage: 'location' },
  { id: 'outline', name: '大纲', mark: '纲', stage: 'outline' },
  { id: 'chapter', name: '章节任务', mark: '章', stage: 'chapter' },
]

type TaskCountRow = {
  total: number | null
  done: number | null
  running: number | null
  failed: number | null
  updated_at: string | null
}

const num = (value: number | null | undefined): number => Number(value ?? 0)

/** 任务簿聚合：跑着的优先于折了的，折了的优先于"全成" */
const taskState = (total: number, done: number, running: number, failed: number): LampState => {
  if (running > 0) return 'running'
  if (failed > 0) return 'failed'
  if (total > 0 && done >= total) return 'done'
  return 'idle'
}

/** 产物聚合：没有章就算闲着，写了一半算在写，全写完算成 */
const artifactState = (total: number, done: number): LampState => {
  if (total === 0 || done === 0) return 'idle'
  if (done >= total) return 'done'
  return 'running'
}

const taskSummary = (total: number, done: number, running: number, failed: number, pending: number): string => {
  if (total === 0) return '还没登记任务'
  const parts = [`${done}/${total} 已成`]
  if (running > 0) parts.push(`${running} 在写`)
  if (pending > 0) parts.push(`${pending} 待跑`)
  if (failed > 0) parts.push(`${failed} 折笔`)
  return parts.join(' · ')
}

export const readWorkflowStatus = (database: Database): WorkflowStatus => {
  const nodes: WorkflowNode[] = []

  for (const lamp of TASK_LAMPS) {
    const row = database
      .query(
        `SELECT count(*) AS total,
                sum(CASE WHEN status = 'done'    THEN 1 ELSE 0 END) AS done,
                sum(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS running,
                sum(CASE WHEN status = 'failed'  THEN 1 ELSE 0 END) AS failed,
                max(updated_at) AS updated_at
           FROM generation_tasks WHERE stage = ?`,
      )
      .get(lamp.stage) as TaskCountRow | null

    const done = num(row?.done)
    const running = num(row?.running)
    const failed = num(row?.failed)
    const total = num(row?.total)

    // 待跑数只用于文案，单独查一次；在跑的那一项也是
    const pending = num(
      (database
        .query("SELECT count(*) AS c FROM generation_tasks WHERE stage = ? AND status = 'pending'")
        .get(lamp.stage) as { c: number | null } | null)?.c,
    )
    const head = database
      .query(
        `SELECT target_key FROM generation_tasks
          WHERE stage = ? AND status IN ('running', 'pending')
          ORDER BY (status = 'running') DESC, updated_at DESC LIMIT 1`,
      )
      .get(lamp.stage) as { target_key: string } | null

    nodes.push({
      id: lamp.id,
      name: lamp.name,
      mark: lamp.mark,
      stage: lamp.stage,
      state: taskState(total, done, running, failed),
      total,
      done,
      running,
      failed,
      current: head ? String(head.target_key) : '',
      summary: taskSummary(total, done, running, failed, pending),
      updated_at: row?.updated_at ? String(row.updated_at) : '',
    })
  }

  /* 写 / 润：从真产物算 */
  const chapterTotal = num((database.query('SELECT count(*) AS c FROM chapters').get() as { c: number | null } | null)?.c)
  const textCount = (stage: 'draft' | 'final') =>
    database
      .query(
        `SELECT count(*) AS c, max(updated_at) AS updated_at
           FROM chapter_texts t WHERE t.stage = ?
             AND EXISTS (SELECT 1 FROM chapters c WHERE c.id = t.chapter_id)`,
      )
      .get(stage) as { c: number | null; updated_at: string | null } | null

  const draft = textCount('draft')
  const final = textCount('final')
  const latestChapter = (stage: 'draft' | 'final') =>
    database
      .query(
        `SELECT c.idx AS idx, c.title AS title
           FROM chapter_texts t JOIN chapters c ON c.id = t.chapter_id
          WHERE t.stage = ? ORDER BY t.updated_at DESC LIMIT 1`,
      )
      .get(stage) as { idx: number; title: string } | null

  const draftChapter = latestChapter('draft')
  const finalChapter = latestChapter('final')

  nodes.push(
    {
      id: 'writer',
      name: '执笔',
      mark: '写',
      stage: 'chapter',
      state: artifactState(chapterTotal, num(draft?.c)),
      total: chapterTotal,
      done: num(draft?.c),
      running: 0,
      failed: 0,
      current: draftChapter ? `第 ${draftChapter.idx} 章 · ${draftChapter.title}` : '',
      summary: chapterTotal === 0 ? '这本书还没有章节' : `初稿 ${num(draft?.c)}/${chapterTotal} 章`,
      updated_at: draft?.updated_at ? String(draft.updated_at) : '',
    },
    {
      id: 'polish',
      name: '润色',
      mark: '润',
      stage: 'polish',
      state: artifactState(chapterTotal, num(final?.c)),
      total: chapterTotal,
      done: num(final?.c),
      running: 0,
      failed: 0,
      current: finalChapter ? `第 ${finalChapter.idx} 章 · ${finalChapter.title}` : '',
      summary: chapterTotal === 0 ? '这本书还没有章节' : `定稿 ${num(final?.c)}/${chapterTotal} 章`,
      updated_at: final?.updated_at ? String(final.updated_at) : '',
    },
  )

  /* 案心：全体灯的脸色归到中枢 */
  const runningNames = nodes.filter((node) => node.state === 'running').map((node) => node.name)
  const failedNames = nodes.filter((node) => node.state === 'failed').map((node) => node.name)
  const doneCount = nodes.filter((node) => node.state === 'done').length

  const hub: WorkflowHub = {
    state: runningNames.length > 0 ? 'running' : failedNames.length > 0 ? 'failed' : doneCount === nodes.length ? 'done' : 'idle',
    current: runningNames.length > 0 ? `${runningNames.join('、')} 在写` : failedNames.length > 0 ? `${failedNames.join('、')} 折笔` : '',
    summary: `${doneCount}/${nodes.length} 盏已成`,
    updated_at: nodes.reduce((latest, node) => (node.updated_at > latest ? node.updated_at : latest), ''),
  }

  return { nodes, hub }
}

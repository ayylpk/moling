/**
 * 小说创作系统 —— 组装、状态、持久化。
 *
 * 这个文件原来叫 run.ts（空文件），但它干的事是"把整套东西接起来"，
 * 不是"跑一次"。所以改名为 system.ts，把入口让给真正的新 run.ts。
 *
 * ── 分三层 ──
 *
 * ① SqliteCheckpointSaver —— 磁盘持久化
 *    LangChain 只提供内存版（MemorySaver），SQLite 版没有现成的，所以自己写一个。
 *    实现完全照 MemorySaver 的行为来，只把两个内存对象换成两张表：
 *      checkpoints(...) / writes(...)
 *    **一个小说一个文件**：resources/checkpoints/<slug>.sqlite。
 *    物理隔离的好处：删小说 = 删文件；单文件不会无限膨胀；出问题好排查。
 *
 * ② NovelState（状态）—— 小说创作该有的东西一个不少
 *    注意分工：**业务真相源始终是数据库**（13 张表 + generation_tasks），
 *    这里的状态是"指针与快照"——当前在写哪本、哪一卷、哪一章、场上已有哪些实体。
 *    把业务数据搬进 LangGraph state 会让已有的 input_hash 幂等、断点续跑、
 *    锚点漂移检查全部失效，所以不搬。
 *
 * ③ createNovelSystem() —— 把 SAgent + 状态 + checkpointer 接起来
 */
import path from "node:path"
import { Database } from "bun:sqlite"
import {
  BaseCheckpointSaver,
  copyCheckpoint,
  getCheckpointId,
  WRITES_IDX_MAP,
  type Checkpoint,
  type CheckpointListOptions,
  type CheckpointMetadata,
  type CheckpointTuple,
  type ChannelVersions,
  type CheckpointPendingWrite,
  type PendingWrite,
} from "@langchain/langgraph-checkpoint"
import type { RunnableConfig } from "@langchain/core/runnables"

import { createSAgent, INITIAL_NOVEL_STATE } from "./SAgent"

/* ==================== 路径 ==================== */

/** 项目根下的 resources/。一个小说一个 id 隔离，都在这个目录下。 */
const RESOURCES_DIR = path.join(import.meta.dir, "../resources")
const CHECKPOINT_DIR = path.join(RESOURCES_DIR, "checkpoints")

/**
 * 一个小说一个 checkpoint 文件。
 *
 * slug 是 novels 表上的唯一键、同时也是磁盘目录名，所以直接拿它当文件名。
 * 不在这里做 slug 合法性校验——业务层建小说时已经校验过了（shared/runPaths.ts
 * 的 SLUG_PATTERN），这里再校验一次只会出现两套规则。
 */
export function checkpointPathFor(slug: string): string {
  return path.join(CHECKPOINT_DIR, `${slug}.sqlite`)
}

/** 这个小说在 checkpointer 里的 thread id。 */
export function threadIdFor(slug: string): string {
  return `novel-${slug}`
}

/* ==================== ① SQLite checkpointer ==================== */

/**
 * 基于 bun:sqlite 的 checkpointer。
 *
 * 行为对着 MemorySaver 抄：同一套 key 结构、同一套 serde 调用、
 * 同一套"没给 checkpoint_id 就取最新"的语义。只把存储介质换掉。
 *
 * 为什么不用 `@langchain/langgraph-checkpoint-sqlite`：
 * 项目没有这个依赖，而且它依赖 better-sqlite3（原生模块），
 * 而这里本来就跑在 Bun 上、已经有 bun:sqlite。为存一份 JSON 引一个原生依赖不划算。
 */
export class SqliteCheckpointSaver extends BaseCheckpointSaver {
  private readonly db: Database

  constructor(dbPath: string) {
    super()
    this.db = new Database(dbPath, { create: true })
    this.db.run(`PRAGMA journal_mode = WAL`)
    this.db.run(`
      CREATE TABLE IF NOT EXISTS checkpoints (
        thread_id            TEXT NOT NULL,
        checkpoint_ns        TEXT NOT NULL,
        checkpoint_id        TEXT NOT NULL,
        parent_checkpoint_id TEXT,
        type                 TEXT,
        checkpoint           BLOB,
        metadata_type        TEXT,
        metadata             BLOB,
        PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
      )
    `)
    this.db.run(`
      CREATE TABLE IF NOT EXISTS writes (
        thread_id     TEXT NOT NULL,
        checkpoint_ns TEXT NOT NULL,
        checkpoint_id TEXT NOT NULL,
        task_id       TEXT NOT NULL,
        idx           INTEGER NOT NULL,
        channel       TEXT NOT NULL,
        type          TEXT,
        value         BLOB,
        PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx)
      )
    `)
  }

  /** 读 pending writes。 */
  private async loadWrites(
    threadId: string,
    ns: string,
    checkpointId: string,
  ): Promise<CheckpointPendingWrite[]> {
    const rows = this.db
      .query<{ task_id: string; channel: string; type: string; value: Uint8Array }, [string, string, string]>(
        `SELECT task_id, channel, type, value FROM writes
         WHERE thread_id = ? AND checkpoint_ns = ? AND checkpoint_id = ?
         ORDER BY task_id, idx`,
      )
      .all(threadId, ns, checkpointId)

    return Promise.all(
      rows.map(
        async (r) =>
          [
            r.task_id,
            r.channel,
            await this.serde.loadsTyped((r.type as "json") ?? "json", r.value),
          ] as CheckpointPendingWrite,
      ),
    )
  }

  private async buildTuple(
    threadId: string,
    ns: string,
    checkpointId: string,
    parentCheckpointId: string | null,
    type: string,
    checkpointBlob: Uint8Array,
    metadataType: string,
    metadataBlob: Uint8Array,
  ): Promise<CheckpointTuple> {
    const tuple: CheckpointTuple = {
      config: { configurable: { thread_id: threadId, checkpoint_ns: ns, checkpoint_id: checkpointId } },
      checkpoint: await this.serde.loadsTyped((type as "json") ?? "json", checkpointBlob),
      metadata: await this.serde.loadsTyped((metadataType as "json") ?? "json", metadataBlob),
      pendingWrites: await this.loadWrites(threadId, ns, checkpointId),
    }
    if (parentCheckpointId) {
      tuple.parentConfig = {
        configurable: { thread_id: threadId, checkpoint_ns: ns, checkpoint_id: parentCheckpointId },
      }
    }
    return tuple
  }

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const threadId = config.configurable?.thread_id
    const ns = config.configurable?.checkpoint_ns ?? ""
    if (threadId === undefined) return undefined

    const explicitId = getCheckpointId(config)

    type Row = {
      checkpoint_id: string
      parent_checkpoint_id: string | null
      type: string
      checkpoint: Uint8Array
      metadata_type: string
      metadata: Uint8Array
    }

    const row = explicitId
      ? this.db
          .query<Row, [string, string, string]>(
            `SELECT checkpoint_id, parent_checkpoint_id, type, checkpoint, metadata_type, metadata
             FROM checkpoints WHERE thread_id = ? AND checkpoint_ns = ? AND checkpoint_id = ?`,
          )
          .get(threadId, ns, explicitId)
      : this.db
          .query<Row, [string, string]>(
            `SELECT checkpoint_id, parent_checkpoint_id, type, checkpoint, metadata_type, metadata
             FROM checkpoints WHERE thread_id = ? AND checkpoint_ns = ?
             ORDER BY checkpoint_id DESC LIMIT 1`,
          )
          .get(threadId, ns)

    if (!row) return undefined
    return this.buildTuple(
      threadId,
      ns,
      row.checkpoint_id,
      row.parent_checkpoint_id,
      row.type,
      row.checkpoint,
      row.metadata_type,
      row.metadata,
    )
  }

  async *list(config: RunnableConfig, options?: CheckpointListOptions): AsyncGenerator<CheckpointTuple> {
    const threadId = config.configurable?.thread_id
    const ns = config.configurable?.checkpoint_ns
    const onlyId = config.configurable?.checkpoint_id
    let { before, limit, filter } = options ?? {}

    type Row = {
      thread_id: string
      checkpoint_ns: string
      checkpoint_id: string
      parent_checkpoint_id: string | null
      type: string
      checkpoint: Uint8Array
      metadata_type: string
      metadata: Uint8Array
    }

    const rows = this.db
      .query<Row, []>(
        `SELECT thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id,
                type, checkpoint, metadata_type, metadata
         FROM checkpoints ORDER BY thread_id, checkpoint_ns, checkpoint_id DESC`,
      )
      .all()

    for (const row of rows) {
      if (threadId !== undefined && row.thread_id !== threadId) continue
      if (ns !== undefined && row.checkpoint_ns !== ns) continue
      if (onlyId && row.checkpoint_id !== onlyId) continue
      const beforeId = before?.configurable?.checkpoint_id
      if (beforeId && row.checkpoint_id >= beforeId) continue

      const metadata = await this.serde.loadsTyped(
        (row.metadata_type as "json") ?? "json",
        row.metadata,
      )
      if (filter && !Object.entries(filter).every(([k, v]) => (metadata as Record<string, unknown>)[k] === v)) {
        continue
      }
      if (limit !== undefined) {
        if (limit <= 0) break
        limit -= 1
      }
      yield await this.buildTuple(
        row.thread_id,
        row.checkpoint_ns,
        row.checkpoint_id,
        row.parent_checkpoint_id,
        row.type,
        row.checkpoint,
        row.metadata_type,
        row.metadata,
      )
    }
  }

  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
    _newVersions: ChannelVersions,
  ): Promise<RunnableConfig> {
    const threadId = config.configurable?.thread_id
    const ns = config.configurable?.checkpoint_ns ?? ""
    if (threadId === undefined) {
      throw new Error(
        "put 失败：config 里缺少 thread_id。使用 checkpointer 时必须传 " +
          '`configurable: { thread_id }`，否则持久化不知道该写到哪个会话。',
      )
    }
    const parentId = config.configurable?.checkpoint_id ?? null
    const prepared = copyCheckpoint(checkpoint)

    const [[cpType, cpBlob], [mdType, mdBlob]] = await Promise.all([
      this.serde.dumpsTyped(prepared),
      this.serde.dumpsTyped(metadata),
    ])

    this.db
      .query(
        `INSERT OR REPLACE INTO checkpoints
         (thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, type, checkpoint, metadata_type, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        threadId,
        ns,
        checkpoint.id,
        parentId,
        cpType,
        cpBlob as Uint8Array,
        mdType,
        mdBlob as Uint8Array,
      )

    return { configurable: { thread_id: threadId, checkpoint_ns: ns, checkpoint_id: checkpoint.id } }
  }

  async putWrites(config: RunnableConfig, writes: PendingWrite[], taskId: string): Promise<void> {
    const threadId = config.configurable?.thread_id
    const ns = config.configurable?.checkpoint_ns ?? ""
    const checkpointId = config.configurable?.checkpoint_id
    if (threadId === undefined || checkpointId === undefined) {
      throw new Error("putWrites 失败：config 里缺少 thread_id 或 checkpoint_id。")
    }

    const insert = this.db.query(
      `INSERT OR IGNORE INTO writes
       (thread_id, checkpoint_ns, checkpoint_id, task_id, idx, channel, type, value)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )

    for (let i = 0; i < writes.length; i++) {
      const write = writes[i]
      if (!write) continue
      const [channel, value] = write
      const [vType, vBlob] = await this.serde.dumpsTyped(value)
      const idx = WRITES_IDX_MAP[channel as keyof typeof WRITES_IDX_MAP] ?? i
      insert.run(threadId, ns, checkpointId, taskId, idx, channel, vType, vBlob as Uint8Array)
    }
  }

  async deleteThread(threadId: string): Promise<void> {
    this.db.query(`DELETE FROM checkpoints WHERE thread_id = ?`).run(threadId)
    this.db.query(`DELETE FROM writes WHERE thread_id = ?`).run(threadId)
  }

  /** 关掉连接。进程退出前调一下，WAL 才会合并回主库。 */
  close(): void {
    this.db.close()
  }
}

/* ==================== ② 状态 ==================== */

/**
 * 状态定义本身在 ./SAgent/state.ts —— 它归 SAgent（那是 SAgent 的状态），
 * 由 SAgent 的 `stateSchema` 声明、由它的 `novelStateSync` 中间件维护。
 * system.ts 只把组装要用的名字转出去，**不再自己定义一份**：
 * 两份定义迟早会分叉，而状态分叉是最难查的一类 bug。
 */
export { NovelState, INITIAL_NOVEL_STATE, type Phase } from "./SAgent"

/* ==================== ③ 组装 ==================== */

export interface NovelSystemOptions {
  /** novels.id */
  novelId: number
  /** novels.slug —— 同时是 checkpoint 文件名 */
  slug: string
}

/**
 * 把整套东西接起来：SAgent + 状态 + 磁盘 checkpointer。
 *
 * 返回的 threadId 就是这一本小说的会话 id：同一个 slug 反复进去，
 * 历史会自动续上（这就是"记忆共享在中心 agent"）。
 */
export function createNovelSystem(options: NovelSystemOptions) {
  const saver = new SqliteCheckpointSaver(checkpointPathFor(options.slug))
  const agent = createSAgent()
  const threadId = threadIdFor(options.slug)

  return {
    agent,
    saver,
    threadId,
    /** 每次 invoke 都带上它，SAgent 的工具靠它知道在写哪本 */
    config: {
      configurable: { thread_id: threadId, novelId: options.novelId },
    },
    /**
     * 每轮 invoke 要一起带上的**状态种子**。
     *
     * `novelId` 是 SAgent 的 `novelStateSync` 中间件推导状态的入口——
     * 不带它，状态就永远停在 `INITIAL_NOVEL_STATE`（中间件拿不到 id 会直接跳过，
     * 这是有意的：宁可状态不动，也不要猜一个 id 去查错库）。
     *
     * 用法：`agent.invoke({ ...system.seed, messages: [...] }, system.config)`
     */
    seed: {
      ...INITIAL_NOVEL_STATE,
      novelId: options.novelId,
      slug: options.slug,
    },
    close: () => saver.close(),
  }
}

export type NovelSystem = ReturnType<typeof createNovelSystem>

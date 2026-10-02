/**
 * Entity —— 与数据库表一一对应的一层。
 *
 * 规则：字段类型 = 数据在 SQLite 里的真实形态。
 * rules / factions / places / terms / forbidden 在库里存的是 JSON 文本，
 * 所以这里就是 string，不是数组。解析成数组是 VO 那一层的事。
 *
 * 这一层不要加业务字段，也不要为了方便改类型 —— 加了就会和表结构对不上。
 */

/* ==================== 共享子结构（打包进 JSON 列的那些） ==================== */

/** 规则。顺序有意义：数组第 1 条是根规则，后面从它派生 */
export interface Rule {
  id: string
  text: string
}

export interface Faction {
  id: string
  name: string
  desc?: string
}

export interface Place {
  id: string
  name: string
  desc?: string
}

/** 专名表：润色 agent 的「不许改」清单 */
export interface Term {
  term: string
  forbidden?: string
  note?: string
}

/* ==================== 枚举（同时约束表上的 CHECK） ==================== */

export const NOVEL_STATUS = ['draft', 'writing', 'paused', 'done'] as const
export type NovelStatus = (typeof NOVEL_STATUS)[number]

/**
 * 流水线阶段。顺序有意义 —— `STAGE_ORDER` 用来做失效传播：
 * 上游一变，下游全部作废。
 *
 * character 与 location 是同一级的兄弟（都由大纲触发），所以并列。
 */
export const STAGE_ORDER = [
  'world',
  'character',
  'location',
  'outline',
  'chapter',
  'polish',
] as const
export type Stage = (typeof STAGE_ORDER)[number]

export const TASK_STATUS = ['pending', 'running', 'done', 'failed', 'stale'] as const
export type TaskStatus = (typeof TASK_STATUS)[number]

/* ==================== novels 表的一行 ==================== */

/** 一本小说。全库的根，其余所有表都挂在它下面 */
export interface NovelEntity {
  id: number
  /** 人类可读的短名，同时当磁盘目录名用（resources/runs/<slug>/），必须是文件系统安全字符 */
  slug: string
  title: string
  /** 题材。agent 本身不绑题材，这里只做归档与检索 */
  genre: string
  /** 文风基准。逐章注入，必须持久 */
  style: string
  status: NovelStatus
  created_at: string
  updated_at: string
}

/* ==================== worlds 表的一行 ==================== */

/** worlds 表的一行 */
export interface WorldEntity {
  id: number
  novel_id: number
  /**
   * 版本号，同一本小说内从 1 递增。
   *
   * 为什么要版本：世界观是最上游的约束，它一改下游（大纲/章节/正文）全部失效。
   * 留版本才能回答「这一卷是基于哪一版世界观生成的」，
   * 也才能把「输入变了要重跑」变成 generation_tasks.input_hash 可比对的事实。
   */
  version: number
  name: string
  premise: string
  rules: string
  factions: string
  places: string
  terms: string
  forbidden: string
  created_at: string
  updated_at: string
}

/* ==================== generation_tasks 表的一行 ==================== */

/**
 * 一个可续跑的工作单元。
 *
 * 这张表是「分阶段产出」的骨架：开工前先按 (novel_id, stage, target_key) 查一眼，
 * 就知道该跳过还是该跑。
 */
export interface GenerationTaskEntity {
  id: number
  novel_id: number
  stage: Stage
  /**
   * 对象标识，字符串。约定：
   *   world     → "v1"
   *   character → "林晚"
   *   location  → "天台"
   *   outline   → "vol:1"（合并后）/"vol:1:seg:2"（分段中间态）
   *   chapter   → "ch:013"
   *   polish    → "ch:013"
   */
  target_key: string
  status: TaskStatus
  /** 已尝试次数。每次 claim 都 +1，用来发现"反复失败的那个点" */
  attempt: number
  /** 输入的指纹。为空表示不参与缓存判断，每次都要跑 */
  input_hash: string
  /** 磁盘上原始产物的相对路径（相对 resources/runs/<slug>/）。库只存指针，不存内容 */
  artifact_path: string
  error: string
  started_at: string | null
  finished_at: string | null
  created_at: string
  updated_at: string
}

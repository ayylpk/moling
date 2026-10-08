/**
 * my-app —— **本项目唯一的后端数据入口**。
 *
 * ============================ 分层 ============================
 *
 *   tool（中心 Agent 的工具）  ─┐
 *                             ├→  index.ts（本文件，门面）→ controller → service → db → SQLite
 *   HTTP 路由（server.ts）    ─┘
 *
 * 各层只做一件事，谁也不许越级：
 *
 *   db          所有 SQLite 访问。列名、表结构、事务**只在这里**。
 *               schema 定义（建表/迁移/开库）也在这一层。
 *   service     业务逻辑。落库之后该做的事都绑在这里：回填引用（章纲里等这个名字的
 *               出场记录）、发记忆。**「一件事」要么全做完，要么不做** —— 拆开就会出现
 *               「库落了、记忆没进」这种查不出来的分叉。
 *   controller  一个动作 = 一次调用。接收 novelId，负责开库关库，返回领域对象。
 *               它是上层唯一看得见的东西。
 *
 * ============================ 为什么用命名空间导出 ============================
 *
 * `listVolumes` 这类名字在多个领域都合理（卷表属于章，但卷纲也按卷组织）。
 * 平铺导出会撞名，撞了就只能改名字或者加前缀 —— 两种都在破坏语义。
 * 按领域分组，调用处读起来也更像一句话：`chapter.saveChapterOutlines(...)`。
 *
 * ============================ 上层能用什么 ============================
 *
 * 中心 Agent 的 tool 与 HTTP 路由都只 import 本文件，**不 import db / service**。
 * 越级就意味着绕过了"落库之后该做的事"，那正是这个分层要防的事。
 */

// ── 领域门面 ──
export * as world from './controller/worldController'
export * as character from './controller/characterController'
export * as location from './controller/locationController'
export * as outline from './controller/outlineController'
export * as chapter from './controller/chapterController'
export * as decision from './controller/actorDecisionController'
export * as workflow from './controller/workflowController'
export * as memory from './controller/memoryController'
export * as catalog from './controller/catalogController'
// 类型 / 文风库：和书架一样不接 novelId —— 这两个维度是全局共享的，不属于任何一本书
export * as flavor from './controller/flavorController'
export * as state from './controller/stateController'
export * as writing from './controller/writingController'
// 草案动线（生成 → 审核 → 采纳/放弃）：中心 Agent 的工具与 HTTP 草案接口都从这里走
export * as draft from './controller/draftController'

// ── 目录库（书架） ──
// 目录级元数据不属于任何一本书，所以没有 novelId 可言，是它自己的一层。
export { listNovelsInCatalog, type CatalogNovel } from './db/connection'
export type { NovelCreateInput } from './service/catalogService'

// ── 类型（上层标注入参/返回值时要用） ──
export type { World, WorldInput } from './db/worldDB'
export type { Character, CharacterInput, CharacterPatch, CharacterBrief } from './db/characterDB'
export type { Location, LocationInput, LocationPatch } from './db/locationDB'
export type { AnchorInput, VolumeOutlineInput } from './db/outlineDB'
export type {
  Volume,
  VolumeInput,
  ChapterOutline,
  ChapterOutlineInput,
  ChapterOutlinePatch,
  ChapterCast,
  ChapterText,
  ChapterStage,
  GenerationTask,
  PendingDemand,
  TextStage,
} from './db/chapterDB'
export type { DecisionInput, ActorDecision } from './db/actorDecisionDB'
export type { Draft, DraftStage } from './db/draftDB'
export type { VolumeOutlineDraftContent, ProseDraftContent } from './service/draftService'
export type { VolumeOutlineBundle, ChapterOutlineSaveReport } from './service/entityService'
export type { WorkflowSummary, StageCounts, WorkflowStage } from './service/workflowService'
export type { ChapterContext } from './controller/chapterController'
export type { NovelStateSnapshot } from './controller/stateController'
export type { WritingBrief, CastSheet, PlaceSheet } from './controller/writingController'
export type {
  FlavorFragments,
  ManagedFlavor,
  SaveOutcome,
  RenameOutcome,
  RemoveOutcome,
} from '../../skills'
export type { GenerationResult, GeneratedFlavor, MaterialInput } from './service/flavorGenerationService'

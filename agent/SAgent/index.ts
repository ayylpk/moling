/**
 * SAgent —— 统一出口。
 *
 * 外部只需要 import 这一个文件：
 *
 *   import { createSAgent, SAGENT_PROMPT, COMPACT_PROMPT } from "../SAgent"
 *
 * 不要深链到 ./agent 或 ./tools/xxx（项目约定：统一从 index 出，
 * 以后拆文件不用改调用方）。
 */
export {
  createSAgent,
  sAgent,
  CONTEXT_BUDGET,
  estimateTokens,
  chapterArtifactCompaction,
} from "./agent"

export { SAGENT_PROMPT, buildSAgentPrompt, type SAgentPromptInput } from "./prompt"

export { COMPACT_PROMPT } from "./compact"

export {
  NovelState,
  INITIAL_NOVEL_STATE,
  PHASE_ORDER,
  deriveNovelState,
  renderStateBlock,
  novelStateSync,
  type Phase,
  type DerivedNovelState,
  type NovelStateValue,
} from "./state"

export { subAgentTools, databaseTools, taskTools, memoryTools, searchNovelMemory, rememberNovelMemory } from "./tools"

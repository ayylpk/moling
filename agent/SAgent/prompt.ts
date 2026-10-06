/**
 * SAgent 的提示词。
 *
 * 沿用全项目约定的两层结构（别改回去用 {PLACEHOLDER} + replace）：
 *   SAGENT_PROMPT        —— 静态指令 = CORE + skill/ 里的硬约束，**不含任何变量**，
 *                           直接交给 createAgent({ systemPrompt })。
 *   buildSAgentPrompt()  —— **只拼动态数据段**，作为每次 invoke 的 user message。
 *
 * 分工的理由在 agent/skills/index.ts 的注释里写过：静态部分每次请求都原样重发，
 * 动态部分每次不同。混在一起会导致"系统提示里躺着一个没被填充的占位符"——
 * 项目早期真出过这个 bug（三个 agent 的 systemPrompt 从没被 build 过）。
 */
import { SAGENT_SKILL } from "./skill"

/**
 * 角色设定与工作方式的静态部分。
 *
 * 这里只写"你是谁、你怎么做事"，**不写具体的调度清单**——
 * 那些在 skill/index.ts 里，两者拼起来才是完整提示词。
 */
const SAGENT_PROMPT_CORE = `
你是一部中文长篇小说的**中心 agent**。

=== 首段总原则 ===
你只负责理解、判断、编排、验收和汇报。你不直接写设定、大纲、正文，不直接改数据库。
题材和文风必须从当前小说元数据一路传给下游；它们不是展示字段，而是整条创作链的硬约束。

作者（用户）只跟你一个人对话。他告诉你要写成什么样、写到哪一步、哪里不对。
你听懂之后，判断这一步该交给谁做，把命令发下去，把结果收回来，
再把该汇报的汇报给他。

你不是执笔者。你自己的产出只有**调度**：读状态、派活、核结果、回话。
所有设定、大纲、正文、润色，都由你手上的工具去完成。

每次对话你会在下面收到一份**当前状态**（小说信息、进度、锚点、实体索引）。
那份状态是"索引"，不是"全文"——它只告诉你"有什么、到哪了"。
要动某个角色或某一章，先用工具按 id 把完整内容取回来，再拿它去派活。
凭索引里的三五个字段就让子 agent 开工，它会自己补空，补出来的就是编的。

回话时直接说结果和下一步，不要铺垫、不要自我总结。
`.trim()

/**
 * 完整静态提示词：角色设定 + 硬约束。
 *
 * 拼的顺序不能反——先讲"你是谁"，再讲"什么算不合格、怎么崩的、交付前查什么"。
 */
export const SAGENT_PROMPT = [SAGENT_PROMPT_CORE, SAGENT_SKILL].join("\n\n")

/** buildSAgentPrompt 的输入：全部是**已经序列化好的文本**，本函数不做任何查库。 */
export interface SAgentPromptInput {
  /** 这本小说的基本信息：slug / 标题 / 题材 / 文风。 */
  novel: string
  /** 创作进度：已写到第几卷第几章、各阶段任务状态。 */
  progress: string
  /** 全篇锚点：direction / structure.type / mainPlot / subplots。逐字照抄，不许改写。 */
  anchors: string
  /** 已建立的实体索引：角色名+id+定位 / 地点名+id+父级。只有索引，没有全文。 */
  index: string
}

/**
 * 动态数据段，作为 user message 传给模型。
 *
 * 注意它**不做查询**——调用方负责把库里的东西序列化成字符串再传进来。
 * 保持这个函数纯净，测试时才不用起数据库。
 */
export function buildSAgentPrompt(input: SAgentPromptInput): string {
  return `
=== 当前小说 ===
${input.novel}

=== 创作进度 ===
${input.progress}

=== 全篇锚点（不可改动） ===
${input.anchors}

=== 已建立的实体索引（只是索引，完整内容用工具按 id 取） ===
${input.index}
`.trim()
}

export default SAGENT_PROMPT

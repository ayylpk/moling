import { createAgent } from "langchain"
import type { BaseChatModel } from "@langchain/core/language_models/chat_models"
import { createModel } from "../create_model"
import * as z from "zod"
import { POLISHER_PROMPT, POLISHER_RHYTHM_PROMPT } from "./prompt"
import { composePrompt, type Flavor } from "../skills"
import { NO_AI_VOICE } from "../skills"

/**
 * 润色结果。
 *
 * 刻意**只留两个字段**：
 *   text    —— 改完的正文
 *   changes —— 逐条列出改了什么，供人工核对
 *
 * `changes` 不是给机器读的，是给**人**读的：润色的红线是"只改表达、不改内容"，
 * 而这个承诺没法靠模型自己保证。唯一的办法是把每处改动摊开，让人十秒钟扫一遍就能
 * 判断它有没有越界。改动列表越短，越说明它改了但没敢大改——这是好事。
 */
export const PolishedTextSchema = z.object({
  text: z.string().describe("润色后的正文。纯文本，不要 markdown 标记，不要改动标记"),
  changes: z
    .array(
      z.object({
        kind: z.enum(["去AI味", "节奏", "用词", "语序"]).describe("改动类型"),
        before: z.string().describe("改前的原句（可截取局部）"),
        after: z.string().describe("改后的句子"),
      }),
    )
    .describe("逐条列出实质性改动；纯粹调标点的不列，但凡可能影响读者理解的一律要列"),
})

export type PolishedText = z.output<typeof PolishedTextSchema>

/**
 * @param options.mode  默认 'sweep'（清扫遍，原行为）；
 *                      'rhythm' = 第二遍（节奏与对白），换一份立场相反的系统提示。
 *
 * ── 为什么要两份系统提示 ──
 * 清扫遍的自检一大半在说"别扭就放着别动""短句是节奏别合并"，那是防它乱改的；
 * 节奏遍的活**就是**合并碎段、破等长、拆回声。同一份提示下，那些守则会把
 * 节奏遍的活整个压死（实测两次润色改写率 6% 和 9%，模型自称"没有可改的"）。
 */
export function createPolisherAgent(
  model: BaseChatModel = createModel(0.3),
  flavor: Flavor = {},
  options: { mode?: 'sweep' | 'rhythm' } = {},
) {
  const core = options.mode === 'rhythm' ? POLISHER_RHYTHM_PROMPT : POLISHER_PROMPT
  return createAgent({
    model,
    systemPrompt: composePrompt(core, 'polisher', flavor.style, flavor.genre, NO_AI_VOICE),
    responseFormat: PolishedTextSchema,
    name: "ProsePolisherAgent",
    description:
      "Polishes finished chapter prose: removes AI writing traces, fixes rhythm and word " +
      "choice. It changes EXPRESSION ONLY — never plot, facts, numbers, relationships, " +
      "character voice traits, or any proper noun in the world's terms table. " +
      "Needs the term table, the forbidden list, the style, and the draft text. " +
      "Returns the polished text plus an itemised list of every substantive change so a " +
      "human can audit it. " +
      "Do NOT call it to rewrite a chapter that is wrong at the plot level — send that back " +
      "to the writer instead; this agent cannot fix story problems and must not try.",
  })
}

export const polisherAgent = process.env.API_KEY || process.env.ANTHROPIC_AUTH_TOKEN
  ? createPolisherAgent()
  : undefined

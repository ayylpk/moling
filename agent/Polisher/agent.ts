import { createAgent } from "langchain"
import type { BaseChatModel } from "@langchain/core/language_models/chat_models"
import { createModel } from "../create_model"
import * as z from "zod"
import { POLISHER_PROMPT } from "./prompt"

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

export function createPolisherAgent(model: BaseChatModel = createModel(0.3)) {
  return createAgent({
    model,
    systemPrompt: POLISHER_PROMPT,
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

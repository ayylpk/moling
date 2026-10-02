import { createAgent } from "langchain"
import type { BaseChatModel } from "@langchain/core/language_models/chat_models"
import { createModel } from "../create_model"
import * as z from "zod"
import { WRITER_PROMPT } from "./prompt"

/**
 * 一章正文的产出。
 *
 * 只留三个字段，理由：
 *   text      —— 正文本身，下游全都要
 *   summary   —— 写回「前情」，跨卷记忆里唯一需要摘要的那一层
 *   endsWith  —— 下一章开写时的起点状态（谁在哪、什么还没解决）
 *
 * 刻意**不要** wordCount：模型自报字数不准，取回来还得自己数一遍。
 * 调用方直接量 text.length 即可。
 */
export const ChapterTextSchema = z.object({
  text: z
    .string()
    .describe("本章正文。纯文本，不要 markdown 标记，不要章节标题行，不要任何解说"),
  summary: z
    .string()
    .describe("本章实际发生了什么，一到两句。写给下一章的前情用，不是给人看的简介"),
  endsWith: z
    .string()
    .describe("结尾状态：谁在哪、身上带着什么、什么还没解决。下一章从这里接"),
})

export type ChapterText = z.output<typeof ChapterTextSchema>

export function createWriterAgent(model: BaseChatModel = createModel(0.7)) {
  return createAgent({
    model,
    systemPrompt: WRITER_PROMPT,
    responseFormat: ChapterTextSchema,
    name: "ChapterWriterAgent",
    description:
      "Writes the prose of ONE chapter from that chapter's outline entry. Needs the world " +
      "bible, the cast and place cards for the characters and places actually appearing, " +
      "the style, what happened immediately before, and the chapter outline itself. " +
      "Optionally takes the Actor agent's rulings for any real fork in this chapter — when " +
      "those are supplied they are binding. " +
      "It writes only what this one chapter's outline asks for: it does not add characters, " +
      "places or plot beats, does not resolve the chapter's hook, and does not use anything " +
      "a character has not been told yet.",
  })
}

export const writerAgent = process.env.API_KEY || process.env.ANTHROPIC_AUTH_TOKEN
  ? createWriterAgent()
  : undefined

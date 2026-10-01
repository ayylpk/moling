import { createAgent } from "langchain"
import type { BaseChatModel } from "@langchain/core/language_models/chat_models"
import { createModel } from "../create_model"
import * as z from "zod"
import { ACTOR_PROMPT } from "./prompt"

/**
 * 扮演一个角色所需的最小切片。字段全部来自 Character，但**只挑能驱动行动的**：
 *   want / cost / need / flaw / line  —— 决定他此刻会怎么选
 *   voice / immutable                 —— 决定他像不像那个人
 *   relations / knows                 —— 决定他这一场对谁什么态度、知道什么
 *
 * 刻意**不注入** arc / reveal / secret：
 *   arc.end 是终点，给了他就会直奔终点，模拟立刻退化成"读答案"；
 *   reveal 是未来的触发条件，给了等于剧透；
 *   secret 由 knows 间接表达（他知道的才进来），不直接给"他在瞒什么"。
 *
 * 切片边界 = 「他此刻自己知道的」+「他自己的驱动力」。多给一样都会让模拟失真。
 */
export interface Actor {
  name: string;
  /** 说话方式：句子长短、口头禅、绝不说的词 */
  voice: string;
  /** 表层欲望 */
  want: string;
  /** 愿意为它付出什么 */
  cost: string;
  /** 真正缺什么，必须与 want 不同 */
  need: string;
  /** 会让他选错的缺陷——最重要的预测器 */
  flaw: string;
  /** 底线，越线即翻脸 */
  line: string;
  /** 不可改的可感知事实，用来演得像 */
  immutable: string[];
  /** 对在场者的态度，只取这一场相关的那几条 */
  relations: string[];
  /** 他此刻知道的事实。**他不知道的绝不能写进来**——这是模拟是否可信的分水岭 */
  knows: string[];
}

/** 一次决策的输入：前情 + 情境 + 三个具体选项 + D 的题面 */
export interface ActorScene {
  /** 此前发生了什么。只写这个角色知道的部分 */
  story: string;
  /** 此刻面临的选择 */
  situation: string;
  /** 三个具体选项 */
  options: { A: string; B: string; C: string };
  /** D 的题面：三个选项都不对时，让他自己给一个新答案 */
  chatPrompt: string;
}

export const ActorChoiceSchema = z.object({
  choice: z.enum(["A", "B", "C", "D"]).describe("选择"),
  customAnswer: z
    .string()
    .describe("选 D 时填你自己给出的新答案；选 A/B/C 时填空字符串"),
  reason: z
    .string()
    .describe("为什么这么选，必须点名是角色卡上哪个字段决定的（want / need / flaw / line / cost）"),
  line: z.string().describe("用这个角色的说话方式，说出他此刻会说的那一句"),
});

export type ActorChoice = z.output<typeof ActorChoiceSchema>

export function createActorAgent(model: BaseChatModel = createModel(0.2)) {
  return createAgent({
    model,
    systemPrompt: ACTOR_PROMPT,
    responseFormat: ActorChoiceSchema,
    name: "ActorAgent",
    description:
      "Plays ONE character and answers what he would actually do at a fork in the story. " +
      "Input is a character slice, what has happened, the situation, and three concrete " +
      "options (A/B/C) plus a D that lets him give his own answer. Output is the pick, " +
      "the card field that decided it, and the line he would say. " +
      "Call it ONLY at a real fork — where this character's want and need pull opposite " +
      "ways, or where his flaw would make him choose wrong. Do NOT call it for every " +
      "chapter. Never put the outline's expected outcome into its context: it must choose " +
      "blind, or it is only agreeing with you. " +
      "It does not write prose, invents no facts, and never speaks as the narrator.",
  })
}

export const actorAgent = process.env.API_KEY || process.env.ANTHROPIC_AUTH_TOKEN
  ? createActorAgent()
  : undefined

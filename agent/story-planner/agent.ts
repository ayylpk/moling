import { createAgent, tool } from "langchain"
import type { BaseChatModel } from "@langchain/core/language_models/chat_models"
import { createModel } from "../create_model"
import * as z from "zod"
import { WORLD_AGENT_SYSTEM_PROMPT } from "./promopt"

export interface World {
  premise: string;           // 一句话前提，唯一，裁决冲突的锚
  rules: Rule[];             //  顺序有意义：第 1 条是根规则，后面从它派生
  factions: Faction[];
  places: Place[];
  terms: Term[];             // 专名表 = 润色 agent 的"不许改"清单
  forbidden: string[];       // 唯一真该用 string[] 的
}

interface Rule {
  ability: string;   // 能做到什么
  cost: string;      // 代价 ← 没有它，这条规则就是外挂
  limit: string;     // 界线 ← 脚本拿它查"有没有写超"
}

interface Faction {
  name: string;
  wants: string;     // 它想要什么 ← 没有它，势力就是背景板
  relation: string;  // 跟主角什么关系
}

interface Place {
  name: string;
  where: string;
  role: string;
}

interface Term {
  name: string;
  aliases?: string[];
}

const RuleSchema = z.object({
  ability: z.string().describe("能做到什么"),
  cost: z.string().describe("代价，没有它这条规则就是外挂"),
  limit: z.string().describe("界线，脚本拿它查有没有写超"),
})

const FactionSchema = z.object({
  name: z.string(),
  wants: z.string().describe("它想要什么"),
  relation: z.string().describe("跟主角什么关系"),
})

const PlaceSchema = z.object({
  name: z.string(),
  where: z.string(),
  role: z.string(),
})

const TermSchema = z.object({
  name: z.string(),
  aliases: z.array(z.string()).optional(),
})

export const WorldSchema = z.object({
  premise: z.string().describe("一句话前提，唯一，裁决冲突的锚"),
  rules: z.array(RuleSchema).describe("顺序有意义：第 1 条是根规则，后面从它派生"),
  factions: z.array(FactionSchema),
  places: z.array(PlaceSchema),
  terms: z.array(TermSchema).describe("专名表，润色 agent 的不许改清单"),
  forbidden: z.array(z.string()),
})


export type WorldInput = z.input<typeof WorldSchema>
export type WorldOutput = z.output<typeof WorldSchema>

export function parseWorld(value: unknown): WorldOutput {
  return WorldSchema.parse(value)
}

export const setWorld = tool(
  async ({ world }: { world: World }) => {
    // TODO: 持久化到磁盘 / 数据库
    return `世界观已保存：${world.premise}`
  },
  {
    name: "set_world",
    description:
      "保存或更新小说世界观。当用户提供新的设定、规则、势力、地点或专名时调用。" +
      "传入完整 World，不要只传改动部分。premise 是唯一最高前提。",
    schema: z.object({ world: WorldSchema }),
  }
)

export function createWorldAgent(model: BaseChatModel = createModel(0.2)) {
  return createAgent({
    model,
    systemPrompt: WORLD_AGENT_SYSTEM_PROMPT,
    responseFormat: WorldSchema,
    name: "worldbuilding_agent",
    description: "Creates and revises a novel's coherent world bible.",
  })
}

export const worldAgent = process.env.API_KEY || process.env.ANTHROPIC_AUTH_TOKEN
  ? createWorldAgent()
  : undefined

import { createAgent, tool } from "langchain"
import type { BaseChatModel } from "@langchain/core/language_models/chat_models"
import { createModel } from "../create_model"
import * as z from "zod"
import { CHARACTER_PROMPT } from "./prompt"

export interface character{
    name: string;
    role: string;
    immutable: string;
    voice: string;
    want: string;
    cost: string;
    need: string;
    secret: string;
    reveal: string;
    line: string;
    flaw: string;
    relations: string[];
    arc: string;
    status: string;
};

const CharacterSchema = z.object({
    name: z.string().describe("姓名"),
    role: z.enum(["protagonist", "antagonist", "support"]).describe("定位（主角/反派/配角）"),
    immutable: z.array(z.string()).describe("不可改事实（身体、出身）"),
    voice: z.string().describe("说话方式"),
    want: z.string().describe("表层欲望（想要什么）"),
    cost: z.string().describe("代价（愿意为它付出什么）"),
    need: z.string().describe("深层需求（真正缺什么）"),
    secret: z.string().describe("隐瞒的事情"),
    reveal: z.string().describe("暴露条件"),
    line: z.string().describe("底线"),
    flaw: z.string().describe("缺陷"),
    relations: z.array(z.object({ id: z.string(), attitude: z.string() })).describe("关系网"),
    arc: z.object({ start: z.string(), end: z.string() }).describe("弧光（起点->重点）"),               
    status: z.enum(["alive", "dead", "disabled"]).describe("状态（活/死/失能）等具体的状态")
});

export type CharacterInput = z.input<typeof CharacterSchema>
export type CharacterOutput = z.output<typeof CharacterSchema>

export function createCharacterAgent(model: BaseChatModel = createModel(0.4)){
  return createAgent({
    model,
    systemPrompt: CHARACTER_PROMPT,
    responseFormat: CharacterSchema,
    name: "CharacterBuildingAgent",
    description:
  "Builds ONE new supporting character to fill a specific dramatic function at a " +
  "specific point in the story — an informant, a rival, a witness, a victim. " +
  "Needs the dramatic function and the story position as input. " +
  "Do NOT use for the protagonist. Do NOT use when a character with this function " +
  "already exists — call listCharacters first and reuse.",
  })
};

export const characterAgent = process.env.API_KEY || process.env.ANTHROPIC_AUTH_TOKEN
  ? createCharacterAgent()
  : undefined
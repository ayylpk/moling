import { createAgent } from "langchain"
import type { BaseChatModel } from "@langchain/core/language_models/chat_models"
import { createModel } from "../create_model"
import * as z from "zod"
import { LOCATION_PROMPT } from "./prompt"
import { composePrompt, type Flavor } from "../skills"
import { NO_AI_VOICE } from "../skills"

export const LocationSchema = z.object({
  name: z.string().describe("地名"),
  parent: z.string().describe("上级地点，只能挂在已有地名之下"),
  signature: z.string().describe("一句话独有的记忆点，不得与已有地点同构"),
  features: z.array(z.string()).describe("3-6 条可感知细节：光、声、气味、天候、质地"),
  role: z.string().describe("这个地点在故事里承担什么"),
});

export type LocationInput = z.input<typeof LocationSchema>
export type LocationOutput = z.output<typeof LocationSchema>

export function createLocationAgent(model: BaseChatModel = createModel(0.6), flavor: Flavor = {}) {
  return createAgent({
    model,
    systemPrompt: composePrompt(LOCATION_PROMPT, 'location', flavor.style, flavor.genre, NO_AI_VOICE),
    responseFormat: LocationSchema,
    name: "LocationBuildingAgent",
    description:
      "Builds ONE new location at the point in the story where it is revealed. The world " +
      "bible only fixes the coarse skeleton; anything smaller is built here. Needs the " +
      "world bible and the dramatic function this place must serve as input. " +
      "Do NOT reuse for an existing place — call listLocations first.",
  })
};

export const locationAgent = process.env.API_KEY || process.env.ANTHROPIC_AUTH_TOKEN
  ? createLocationAgent()
  : undefined

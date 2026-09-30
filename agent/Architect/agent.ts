import { createAgent, tool } from "langchain"
import type { BaseChatModel } from "@langchain/core/language_models/chat_models"
import { createModel } from "../create_model"
import * as z from "zod"
import { ARCHITECT_PROMPT } from "./prompt"


export interface Outline {
  direction: StoryDirection;
  structure: PlotStructure;
  pacing: PacingPlan;
  constraints: OutlineConstraints;
  chapters: ChapterOutline[];
}

export interface StoryDirection {
  logline: string;
  theme: string;
  coreConflict: string;
  endingDirection: string;
}

export interface PlotStructure {
  type: "three-act" | "four-act" | "hero-journey" | "custom";
  acts: Act[];
  mainPlot: Plotline;
  subplots: Plotline[];
  turningPoints: TurningPoint[];
}

export interface Act {
  id: string;
  name: string;
  goal: string;
  summary: string;
  startChapter: number;
  endChapter: number;
  keyEvents: string[];
}

export interface Plotline {
  id: string;
  name: string;
  type: "main" | "sub";
  goal: string;
  conflict: string;
  resolution: string;
  involvedCharacters: string[];
}

export interface TurningPoint {
  id: string;
  type: "inciting" | "plot-point-1" | "midpoint" | "plot-point-2" | "climax" | "resolution";
  chapter: number;
  description: string;
  impact: string;
}

export interface PacingPlan {
  tensionCurve: TensionPoint[];
  climaxChapters: number[];
  restChapters: number[];
  hookDensity: number;
}

export interface TensionPoint {
  chapter: number;
  intensity: number;
}

export interface OutlineConstraints {
  timeline: string;
  locations: string[];
  rules: string[];
  forbidden: string[];
}


export interface ChapterOutline {
  index: number;
  title: string;
  goal: string;
  conflict: string;
  hook: string;
  emotion: string;
  summary: string;
  characters: string[];
  wordCountTarget: number;
}

const StoryDirectionSchema = z.object({
  logline: z.string().describe("一句话故事"),
  theme: z.string().describe("主题"),
  coreConflict: z.string().describe("核心冲突"),
  endingDirection: z.string().describe("结局走向"),
});

const ActSchema = z.object({
  id: z.string().describe("幕 ID"),
  name: z.string().describe("幕名"),
  goal: z.string().describe("这一幕的目标"),
  summary: z.string().describe("这一幕讲什么"),
  startChapter: z.number().describe("起始章"),
  endChapter: z.number().describe("结束章"),
  keyEvents: z.array(z.string()).describe("关键事件"),
});

const PlotlineSchema = z.object({
  id: z.string().describe("线 ID"),
  name: z.string().describe("线名"),
  type: z.enum(["main", "sub"]).describe("主线/支线"),
  goal: z.string().describe("这条线要达成什么"),
  conflict: z.string().describe("这条线的冲突"),
  resolution: z.string().describe("这条线怎么收"),
  involvedCharacters: z.array(z.string()).describe("涉及角色"),
});

const TurningPointSchema = z.object({
  id: z.string().describe("转折点 ID"),
  type: z
    .enum(["inciting", "plot-point-1", "midpoint", "plot-point-2", "climax", "resolution"])
    .describe("转折点类型"),
  chapter: z.number().describe("发生在第几章"),
  description: z.string().describe("发生了什么"),
  impact: z.string().describe("造成什么影响"),
});

const PlotStructureSchema = z.object({
  type: z.enum(["three-act", "four-act", "hero-journey", "custom"]).describe("结构类型"),
  acts: z.array(ActSchema).describe("幕列表"),
  mainPlot: PlotlineSchema.describe("主线"),
  subplots: z.array(PlotlineSchema).describe("支线"),
  turningPoints: z.array(TurningPointSchema).describe("转折点"),
});

const TensionPointSchema = z.object({
  chapter: z.number().describe("第几章"),
  intensity: z.number().describe("张力强度 0-10"),
});

const PacingPlanSchema = z.object({
  tensionCurve: z.array(TensionPointSchema).describe("张力曲线"),
  climaxChapters: z.array(z.number()).describe("高潮章"),
  restChapters: z.array(z.number()).describe("缓冲章"),
  hookDensity: z.number().describe("钩子密度"),
});

const OutlineConstraintsSchema = z.object({
  timeline: z.string().describe("时间线"),
  locations: z.array(z.string()).describe("地点"),
  rules: z.array(z.string()).describe("规则"),
  forbidden: z.array(z.string()).describe("禁止事项"),
});

const ChapterOutlineSchema = z.object({
  index: z.number().describe("第几章"),
  title: z.string().describe("章节标题"),
  goal: z.string().describe("本章目标"),
  conflict: z.string().describe("本章冲突"),
  hook: z.string().describe("结尾钩子"),
  emotion: z.string().describe("情绪走向"),
  summary: z.string().describe("本章概要"),
  characters: z.array(z.string()).describe("出场角色"),
  wordCountTarget: z.number().describe("目标字数"),
});

const OutlineSchema = z.object({
  direction: StoryDirectionSchema.describe("故事走向"),
  structure: PlotStructureSchema.describe("情节结构"),
  pacing: PacingPlanSchema.describe("节奏与张力"),
  constraints: OutlineConstraintsSchema.describe("一致性约束"),
  chapters: z.array(ChapterOutlineSchema).describe("章节数组"),
});

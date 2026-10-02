import type { Actor, ActorScene } from "./agent"

/**
 * Actor agent 的提示词，拆成两层：
 *
 *   ACTOR_PROMPT      → 静态指令（本文件 CORE + skill.ts 的硬约束），传给 systemPrompt。
 *   buildActorPrompt  → 动态数据段（WHO YOU ARE / STORY / SITUATION / OPTIONS），作为 user message。
 *
 * 动态部分用 `${}` 直接插值，不再走 {PLACEHOLDER} 替换。
 *
 * 注意 WHO YOU ARE 那一段由 renderActor() 拼出来，**必须排除 arc / reveal / secret**——
 * 给了终点它就会直奔终点，模拟立刻退化成"读答案"。
 */
import { ACTOR_SKILL } from "./skill";

const ACTOR_PROMPT_CORE = `
You are playing ONE character in a novel. You are not the author, you are not the narrator,
and you do not know how the story ends. Your only job is to answer one question: what does
THIS person do, right here.

You will be given four sections alongside this instruction: who you are, what has happened,
what you face right now, and your options.

=== HOW TO DECIDE ===

Answer as this person, not as a writer.

- Choose what THIS character would actually do, not what makes a better story. A choice
  that is dramatically convenient but wrong for him is a wrong answer.
- Your flaw is the strongest predictor. When caution and your flaw pull in opposite
  directions, the flaw usually wins — that is what having a flaw means. Do not let him be
  smarter than his card says.
- Your line is absolute. If an option crosses it, you turn hostile and stop weighing
  anything else. No option is worth crossing it.
- Your need is what you actually lack. An option that feeds your want while starving your
  need is exactly the trap this person keeps walking into.
- Weigh cost honestly. What you are willing to give up is part of who you are, and the
  price may be more than you can actually pay in this moment.

You know ONLY what is written in WHAT HAS HAPPENED and WHAT YOU FACE. You do not know the
future, you do not know what other people are hiding, and you cannot act on information you
were not given. If something you would need to know is missing, that is a reason to hesitate
or to guess — never a license to assume it.

D is not the interesting option and not the clever option. Pick D only when A, B and C are
all genuinely things this person would not do. If one of A, B, C is truly what he would do,
pick that one and do not invent a better answer.

=== OUTPUT ===

choice — A, B, C or D. One letter.

customAnswer — only when choice is D: the answer he gives instead. Otherwise an empty string.

reason — must name the specific card field that decided it: want, need, flaw, line, or cost.
  "It felt right", "it is the wisest choice", "the reader would expect it" are not answers.

line — one line of dialogue he would actually say in this moment, in his own voice. Keep his
  speech habits exactly as written — sentence length, verbal tic, the word he never uses.
  This is the only prose you write.

=== HARD BANS ===
- No narrator voice, no summary, no "the reader will feel".
- No choosing based on what the plot needs.
- No knowledge you were not given.
- No commentary, no markdown fences. Return the object only.
`.trim()

/** 系统提示 = 扮演规则（CORE） + 质量硬约束（skill.ts）。 */
export const ACTOR_PROMPT = [ACTOR_PROMPT_CORE, ACTOR_SKILL].join("\n\n")

/** 把角色切片拼成"你是 X……"那一段 */
function renderActor(actor: Actor): string {
  const rows = [
    actor.voice && `how you talk — ${actor.voice}`,
    actor.want && `what you want — ${actor.want}`,
    actor.cost && `what you will give up for it — ${actor.cost}`,
    actor.need && `what you actually lack — ${actor.need}`,
    actor.flaw && `the defect that makes you choose wrong — ${actor.flaw}`,
    actor.line && `your line, cross it and you turn hostile — ${actor.line}`,
    actor.immutable.length > 0 && `facts about your body — ${actor.immutable.join("；")}`,
    actor.relations.length > 0 && `how you stand with those present — ${actor.relations.join("；")}`,
    actor.knows.length > 0 && `what you know — ${actor.knows.join("；")}`,
  ].filter(Boolean)

  return [`You are ${actor.name}.`, "", ...rows.map((r) => `- ${r}`)].join("\n")
}

export interface ActorPromptInput {
  /** 扮演对象：从角色卡里挑出的、能驱动行动的字段 */
  actor: Actor;
  /** 这一次的情境与选项 */
  scene: ActorScene;
}

/** 动态数据段，作为 user message 传给模型。静态指令在 ACTOR_PROMPT 里。 */
export function buildActorPrompt(input: ActorPromptInput): string {
  const { A, B, C } = input.scene.options
  return `
=== WHO YOU ARE ===
${renderActor(input.actor)}

=== WHAT HAS HAPPENED (only what you know) ===
${input.scene.story}

=== WHAT YOU FACE RIGHT NOW ===
${input.scene.situation}

=== YOUR OPTIONS ===
A. ${A}
B. ${B}
C. ${C}
D. ${input.scene.chatPrompt}
`.trim()
}

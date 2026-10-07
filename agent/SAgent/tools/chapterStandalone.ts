import { tool } from 'langchain'
import type { RunnableConfig } from '@langchain/core/runnables'
import * as z from 'zod'
import { chapter as chapterApi, writing as writingApi, type ChapterContext, type ChapterOutline } from '../../my-app'
import { createModel } from '../../create_model'
import { createWriterAgent } from '../../writer/agent'
import { buildWriterPrompt } from '../../writer/prompt'
import { createPolisherAgent } from '../../Polisher/agent'
import { buildPolisherPrompt, buildPolisherRhythmPrompt } from '../../Polisher/prompt'
import { createChapterWorkflow, type ChapterDraft, type ChapterPolish } from '../chapterWorkflow'
import { flavorOf, novelIdOf, novelOf } from './context'

/**
 * 润色重试的追加句。
 *
 * 单独拼在 buildPolisherPrompt 的结果后面，而不是写进 POLISHER_PROMPT ——
 * 「上一次一个字都没改」这句话**只对第二遍成立**，常驻在系统提示里会让第一遍
 * 去改动本来没问题的地方。红线（NO_AI_VOICE）在系统提示里，不受这里影响。
 */
const RETRY_NOTE = '★ 注意：你上一次一个字都没改，这不合格。这一遍必须真的动 —— 上一版里机器味最重的地方，就是你要动的地方。'

/**
 * 执笔扩写重试的追加句。
 *
 * 与 RETRY_NOTE 同一个思路：这句话**只对"上一遍太短"成立**，所以拼在第一遍结果后面、
 * 不能常驻系统提示 —— 常驻会让没超的一遍也去硬凑字。
 *
 * ── 为什么要兜这一层 ──
 * 写手最常交的不是坏章，是**半章**：章纲五个节拍它写了两个，读着还挺完整
 * （结尾也收住了），一数字数只有目标的一半。润色的规矩是"±15% 以内"，
 * 所以初稿短，终稿只会跟着短 —— 拦不住就在源头拦。
 */
const EXPAND_NOTE = (target: number, actual: number) =>
  `★ 注意：你上一遍只写了 ${actual} 字，这一章的目标是 ${target} 字 —— 你写的是这个事件的梗概，不是正文。` +
  '不许新增事件、人物、地点 —— 章纲有什么就是什么。扩写的正确方式是**把镜头放慢**：' +
  '把一句带过的动作拆成它实际经历的几步（手先做什么、脚踩在哪里、身体哪一下失去平衡）；' +
  '让一句被转述的对白真的发生（一问一答，带停顿和改口）；给场景以具体的感官（气温、光、声音、触感）。' +
  '镜头放慢不是注水：不加形容词堆砌，不写与事件无关的心理独白，不在结尾补总结。'

/**
 * 节奏诊断：把"读着像 AI"的**结构特征**扫成一张具体的靶子清单。
 *
 * 这是第二遍润色的输入。novel-deai-polish 的核心方法论是"先诊断再修改"——
 * 给模型一张命中的清单，它改得又准又克制；不给清单让它自由发挥，
 * 它就会去改本来没问题的地方（实测：整章润完净字数变化 0，报告里全是标点级微调）。
 *
 * 这里只扫**机器能扫的**：引号形态、等长段落、等长对白行。
 * 回声循环和照抄例句是语义判断，交给模型在第二遍里自己找。
 */
/** 节奏诊断：把"读着像 AI"的结构特征扫成一张具体的靶子清单（导出以便直接单测）。 */
export const diagnoseRhythm = (text: string): string[] => {
  const targets: string[] = []

  const corner = (text.match(/[「」『』]/g) || []).length
  if (corner > 0) {
    targets.push(`对白引号还有 ${corner} 处直角引号（「」『』），全部换成 “”，句内标点一并按大陆习惯理顺。`)
  }

  const paras = text.split(/\n+/).map((p) => p.trim()).filter(Boolean)

  // 连续等长段落：相邻段字数差 ≤6 且连续 3 段以上 —— 这是最典型的机器节奏
  let run = 1
  let start = 0
  const flush = (end: number) => {
    if (run >= 3) {
      targets.push(`第 ${start + 1}–${end + 1} 段长度几乎一样（${paras.slice(start, end + 1).map((p) => p.length).join('、')} 字），合并或改写其中一段，打破对称。`)
    }
  }
  for (let i = 1; i < paras.length; i++) {
    const current = paras[i]?.length ?? 0
    const previous = paras[i - 1]?.length ?? 0
    if (Math.abs(current - previous) <= 6) {
      run += 1
      if (run === 2) start = i - 1
    } else {
      flush(i - 1)
      run = 1
    }
  }
  flush(paras.length - 1)

  // 连续等长对白行：连续 3 行以上以引号开头的段落
  const streaks: number[] = []
  let streak: number[] = []
  for (const p of paras) {
    if (/^[“「[]/.test(p)) streak.push(p.length)
    else { if (streak.length >= 3) streaks.push(streak.length); streak = [] }
  }
  if (streak.length >= 3) streaks.push(streak.length)
  if (streaks.length > 0) {
    targets.push(`有 ${streaks.length} 处连续 ${streaks.join('、')} 行的等长对白，把其中一行换成动作，或让一句话说一半被打断。`)
  }

  return targets
}

/**
 * 改写率：按**段落**算（两边的段落多重集比对，内容相同的抵消）。
 *
 * 为什么不用"文本是否相同"：实测润色会把「，」换成「。」交上来 —— 有 diff，
 * 字数分毫不差，整章节奏原样。那种交付在段落级一眼就能看出来：
 * 三十多个段落里只动了两个。
 *
 * 阈值 0.2：空转形态实测在 4%–9%，正常润过远高于此。取 20% 而不是更高，
 * 是因为一份本身干净的稿子确实没那么多可改 —— 闸门要拦的是"没动"，不是逼它凑数。
 */
export const paragraphChangeRate = (before: string, after: string): number => {
  const a = before.split(/\n+/).map((p) => p.trim()).filter(Boolean)
  const b = after.split(/\n+/).map((p) => p.trim()).filter(Boolean)
  if (a.length === 0) return 0
  const remaining = new Map<string, number>()
  for (const p of b) remaining.set(p, (remaining.get(p) ?? 0) + 1)
  let unchanged = 0
  for (const p of a) {
    const n = remaining.get(p) ?? 0
    if (n > 0) { unchanged += 1; remaining.set(p, n - 1) }
  }
  return (a.length - unchanged) / a.length
}
/**
 * 前情：调用方给了就用它；没给且不是第一章，就从库里取上一章的摘要与结尾状态。
 *
 * ── 为什么要有这个兜底 ──
 * 中心 Agent 的编排说明里写了「只调一次 generate_chapter(chapterIdx=章号)」，
 * previous 是个可选参数，于是常常不传。而 writerPrompt 里写的是
 * `previous || '这是开篇，没有前情。'` —— 于是第 2 章被当成开篇写：
 * 它读不到第 1 章末尾那个还没解释的钩子，衔接就断了。
 *
 * 而且**不会报错**。第 2 章本身自洽（章纲说要找实物证据，它就去翻抽屉），
 * 只是和第 1 章对不上。校验的人往往只逐章看，看不出两章之间少了东西。
 *
 * 兜底只能给到摘要和结尾状态，够接钩子、不够接细腻的情绪。
 * 所以 skill 里仍然要求中心 Agent 自己写 —— 两层都留着。
 */
const resolvePrevious = (
  runtime: Pick<ChapterContext, 'getText'>,
  chapterIdx: number,
  given?: string,
): string => {
  if (given?.trim()) return given.trim()
  if (chapterIdx <= 1) return ''
  const prior = runtime.getText(chapterIdx - 1, 'final') ?? runtime.getText(chapterIdx - 1, 'draft')
  if (!prior) return ''
  return [
    prior.summary ? `上一章（第 ${chapterIdx - 1} 章）发生了什么：${prior.summary}` : '',
    prior.endsWith ? `上一章结束时的状态：${prior.endsWith}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

export const generateChapterTool = tool(
  async ({ chapterIdx, previous, decisions }, config) => {
    const novelId = novelIdOf(config)
    const novel = novelOf(config)
    // 两个真 agent，各自带 responseFormat（zod schema）。
    // 不用裸模型 + 正则抠 JSON：结构化输出该由模型层保证，抠出来的那一版已经错了。
    //
    // 温度沿用原值（writer 0.7 / polisher 0.3）。maxTokens 必须显式给：
    // 一章正文 3000–4000 字 ≈ 6000+ token，加上 summary/endsWith 与 JSON 结构开销，
    // 不给上限时长章会中途截断 —— 而截断出来的正文读着还挺完整，只是结尾断在半句上。
    const writer = createWriterAgent(createModel(0.7, 300_000, false, 8192), flavorOf(config))
    const polisher = createPolisherAgent(createModel(0.3, 180_000, false, 8192), flavorOf(config))
    /*
     * 第二遍用**另一份系统提示 + 高温度**：清扫遍的"别扭就放着别动"守则会把节奏遍的活压死
     * （实测 0.3 温度下两次改写率 6% 和 9%，模型自称"没有可改的"）。
     * 节奏改造是**创作判断**不是校对，温度沿用写手的 0.7。
     */
    const rhythmPolisher = createPolisherAgent(createModel(0.7, 180_000, false, 8192), flavorOf(config), { mode: 'rhythm' })

    // 一次开库跑完整条链：plan → claim → 执笔 → draft → 润色 → final → 收尾。
    // 中间夹着两次模型调用，逐步开库关库既慢，也让「这一章的多个步骤」没有同一个事务视角。
    const result = await chapterApi.withChapterConnection(novelId, async (ctx) => {
      const chapter = ctx.getChapter(chapterIdx)
      if (!chapter) throw new Error(`找不到第 ${chapterIdx} 章章纲`)

      // 前情：调用方给了就用它；没给且不是第一章，就从库里取上一章的摘要与结尾状态。
      // 不兜这个底，第 2 章会被当成开篇写 —— 它读不到第 1 章末尾的钩子，衔接就断了，
      // 而且不会报错，只会写出一章自成体系却接不上的正文。
      const previousText = resolvePrevious(ctx, chapterIdx, previous)

      // 取材：只用本章出场的人、只用此刻合法的字段（secret/reveal/arcEnd 一律不给）。
      // 取材与渲染都在 my-app 后面 —— 「该给 writer 看什么」是业务判断，不该由调用方自觉传参。
      const brief = writingApi.getWritingBrief(ctx.database, novelId, chapter)
      const rendered = writingApi.renderBrief(brief)

      // 指纹只跟"这一章的输入"走：输入没变才允许复用已存的初稿
      const fingerprint = JSON.stringify({ chapter, previous: previousText, decisions, brief: rendered })

      const workflow = createChapterWorkflow({
        plan: async (input) => { ctx.planTask('chapter', String(input.chapterIdx), fingerprint) },
        claim: async (input) => {
          const task = ctx.claimTask('chapter', String(input.chapterIdx), fingerprint)
          return { action: task.action, taskId: task.taskId }
        },
        write: async (): Promise<ChapterDraft> => {
          // 章纲上的目标是**硬下限**：低于八成就是"写了章纲摘要而不是正文"。
          // 目标缺失时退回 3000（建表默认值），不猜。
          const target = Number.isFinite(chapter.wordCountTarget) ? Number(chapter.wordCountTarget) : 3000
          const floor = Math.round(target * 0.8)
          const ask = (extra: string) => writer.invoke({
            messages: [{
              role: 'user',
              content: `${buildWriterPrompt({
                world: rendered.world,
                cast: rendered.cast,
                places: rendered.place,
                style: novel.style || '无特别文风要求，按世界观基调走。',
                genre: novel.genre || '未指定题材，严格遵守世界观与章纲。',
                previous: previousText || '这是开篇，没有前情。',
                chapter: rendered.chapter,
                decisions: decisions?.trim() || '无',
              })}${extra}`,
            }],
          })

          const value = await ask('')
          // structuredResponse 是 zod schema 校验过的返回值 —— 比从文本里抠 JSON 可靠
          const drafted = value.structuredResponse
          if (!drafted?.text?.trim()) throw new Error('执笔 Agent 返回空正文')

          /*
           * 长度兜底：短了就**重写一遍**（不是让润色去凑 —— 润色的规矩是贴着原文 ±15%）。
           * 只重试一次：再来还是短，就把短的交出去并如实报告，别在这里死循环烧钱。
           * 取"更长的那一版"：扩写偶尔会更短，那说明它在硬凑，不收。
           */
          let draft: ChapterDraft = { text: drafted.text, summary: drafted.summary ?? '', endsWith: drafted.endsWith ?? '' }

          /*
           * 长度兜底：短了就**重写**（不是让润色去凑 —— 润色的规矩是贴着原文 ±15%）。
           * 最多补写两次：实测一次扩写后仍可能停在目标的七成上下。
           * 某一遍比上一版更短 = 它在硬凑，立刻停，取现有的最长版。
           */
          let expandAttempts = 0
          while (draft.text.length < floor && expandAttempts < 3) {
            expandAttempts += 1
            const second = await ask(`\n\n${EXPAND_NOTE(target, draft.text.length)}`)
            const expanded = second.structuredResponse
            if (!expanded?.text?.trim() || expanded.text.length <= draft.text.length) break
            draft = { text: expanded.text, summary: expanded.summary ?? draft.summary, endsWith: expanded.endsWith ?? draft.endsWith }
          }
          return draft
        },
        loadDraft: async () => {
          const draft = ctx.getText(chapterIdx, 'draft')
          if (!draft) throw new Error(`第 ${chapterIdx} 章没有可复用的初稿`)
          return { text: draft.text, summary: draft.summary, endsWith: draft.endsWith }
        },
        polish: async (input): Promise<ChapterPolish> => {
          const base = buildPolisherPrompt({
            terms: brief.terms || '（这本书还没有专名表）',
            forbidden: brief.forbidden || '（无特别禁令）',
            style: novel.style || '按世界观基调走。',
            genre: novel.genre || '未指定题材，严格遵守世界观与章纲。',
            text: input.draft.text,
          })
          const invokeSweep = () => polisher.invoke({
            messages: [{ role: 'user', content: input.polishRetry === true ? `${base}\n\n${RETRY_NOTE}` : base }],
          })

          /* ── 第一遍：清扫。禁用词、引号形态、标点 —— 机械活 ── */
          const value = await invokeSweep()
          const polished = value.structuredResponse
          if (!polished?.text?.trim()) throw new Error('润色 Agent 返回空正文')
          const changes = Array.isArray(polished.changes) ? polished.changes : []
          // 空转条目不是改动：before 与 after 一样的那种从审计清单里去掉。
          // 留着它们等于替模型把「我改了」这句话记进档案，而它其实一个字都没动。
          const applied = changes.filter((change) => change.before !== change.after)
          let report: unknown = { changes: applied, droppedNoop: changes.length - applied.length }

          /*
           * ── 第二遍：节奏与对白 ──
           * 第一遍的约束（贴原文 ±15%）决定了它只能做标点级修补 —— 实测整章净字数变化 0，
           * 报告里全是「，」换「。」。所以这里拿诊断出的靶子再过一遍，
           * 专打等长段落、等长对白行、回声循环。
           * 没扫出靶子就跳过：稿子本身没这个病，不用硬治。
           */
          const targets = diagnoseRhythm(polished.text)
          if (targets.length > 0) {
            const rhythmValue = await rhythmPolisher.invoke({
              messages: [{
                role: 'user',
                content: buildPolisherRhythmPrompt({
                  terms: brief.terms || '（这本书还没有专名表）',
                  forbidden: brief.forbidden || '（无特别禁令）',
                  style: novel.style || '按世界观基调走。',
                  genre: novel.genre || '未指定题材，严格遵守世界观与章纲。',
                  text: polished.text,
                  targets,
                }),
              }],
            })
            const rhythm = rhythmValue.structuredResponse
            if (rhythm?.text?.trim() && rhythm.text !== polished.text) {
              const rhythmChanges = Array.isArray(rhythm.changes) ? rhythm.changes : []
              report = {
                changes: [
                  ...applied,
                  ...rhythmChanges
                    .filter((change) => change.before !== change.after)
                    .map((change) => ({ ...change, kind: change.kind || '节奏' })),
                ],
              }
              polished.text = rhythm.text
            }

            /*
             * 改写率闸门：诊断明明扫出了靶子，改完却几乎没动段落 —— 那这一遍又是空转。
             * 与其安静交付一份没润过的稿子，不如让这一章失败：初稿已经落库，重跑不会丢稿。
             *
             * 阈值 20%：空转形态实测在 4%–9%，正常润过应该远高于此。取 20% 而不是更高，
             * 是因为一份本身干净的稿子确实没那么多可改 —— 闸门要拦的是"没动"，不是逼它凑数。
             */
            const rate = paragraphChangeRate(input.draft.text, polished.text)
            if (rate < 0.2) {
              throw new Error(
                `润色改写率只有 ${Math.round(rate * 100)}%（按段落计），低于 20% 下限 —— ` +
                `机器扫出的 ${targets.length} 个节奏靶子基本没动，这样的稿子不能当终稿交付。` +
                '请重跑这一章；重跑不会丢内容，初稿已经落库。',
              )
            }
          }

          return { text: polished.text, report }
        },
        // 终稿的记忆由 ctx.saveText 按 stage 决定要不要发（只有 final 记）
        save: async (input) => {
          ctx.saveText(input.chapterIdx, { stage: input.stage, text: input.text, summary: input.summary, endsWith: input.endsWith, polishReport: input.polishReport })
        },
        finish: async (input) => { ctx.finishTask(input.taskId) },
        fail: async (input) => { if (input.taskId !== undefined) ctx.failTask(input.taskId, input.error) },
      })

      return workflow({ novelId, chapterIdx, previous, decisions })
    })

    return JSON.stringify(result, null, 2)
  },
  {
    name: 'generate_chapter',
    description: '中心 Agent 的单次章节编排入口：直接读取本小说 SQLite，调用执笔模型和润色模型，保存 draft/final，失败收口并自动写入记忆。前端不参与中间步骤。',
    schema: z.object({ chapterIdx: z.number().int().positive(), previous: z.string().optional(), decisions: z.string().optional() }),
  },
)

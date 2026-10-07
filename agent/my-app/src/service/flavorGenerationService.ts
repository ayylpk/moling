import { aliyunChat, textModel, visionModel } from '../../../aliyun'
import { DIMENSION_AGENTS, type AgentKey } from '../../../skills'
import { readDocxText } from '../shared/docxText'

/**
 * 素材 → 一个类型 + 一个文风。
 *
 * ============================ 两步，不是一步 ============================
 *
 *   素材 ──→ （图片用视觉模型 / 文本直接沿用）──→ 素材画像 ──→ 文本模型 ──→ 9 个片段
 *
 * 为什么不用视觉模型一口气出片段：9 个片段是长输出，落在输出价 2 元/百万的文本模型上，
 * 比落在 10 元/百万的视觉模型上**便宜约三倍**。视觉模型只干它不可替代的那件事——读图。
 * 文本素材更是没必要过视觉模型，直接用原文当画像。
 *
 * ============================ 素材零留存 ============================
 *
 * 图片是 base64 直接进请求体，文本直接进请求体。**全流程不落盘**：
 * 不写文件、不存路径、不存文件名、不留来源注释。函数返回后素材就不在任何地方了。
 */

/** 素材。图片走 base64（百炼 OpenAI 兼容模式不支持 file:// 本地路径） */
export type MaterialInput =
  | { kind: 'image'; mediaType: string; base64: string }
  | { kind: 'text'; text: string }
  /** .docx 的原始字节（base64）。**在这里就地解成文本**，不落到任何地方 */
  | { kind: 'document'; base64: string }

export type GeneratedFlavor = {
  name: string
  fragments: Partial<Record<AgentKey, string>>
  /** 名字被改过（原名字含点号/路径字符/超长）时会说一句，前端好提示用户 */
  nameNote?: string
}

export type GenerationResult = {
  genre: GeneratedFlavor
  style: GeneratedFlavor
  /** 中间步骤的素材画像 —— 回给前端，让人看得见"模型到底读到了什么" */
  portrait: string
  models: { vision: string | null; text: string }
}

/* ==================== 第一步：读素材 ==================== */

/** 文本素材截断上限。超长素材对判断题材没有额外信息，只是烧 token */
const TEXT_LIMIT = 6000

const PORTRAIT_SYSTEM = [
  '你是中文长篇小说的策划编辑。看一份素材，判断它适合写成什么题材、该配什么文风。',
  '只说可观察的东西：内容里有什么、色调、节奏感、情绪浓度、可能的读者群。',
  '',
  '**判断要抽象到题材与文风层面**：不要出现素材里的具体句子、数字、地名、人名、道具名。',
  '你要交的是"这是什么题材、该配什么文风"，不是"这篇写了什么"。',
  '不要客套，不要复述素材，不要给建议。',
  '限 300 字以内，中文，不要 AI 腔（不写"不由得""仿佛"，不直陈情绪，不用破折号）。',
].join('\n')

const PORTRAIT_ASK = '这份素材适合什么题材？该配什么文风？说出依据。'

/**
 * 素材 → 抽象画像。
 *
 * **两条路都必须产出"判断"，不能把原始素材直接交给下一步。**
 * 文本素材一度是直接沿用原文的（看起来省一次调用），结果模型把素材里的原句、
 * 数字、地名原封不动抄进了"通用规则"里 —— 实测连着两轮都这样，加提示词约束也压不住，
 * 因为原文就在输入里，抄它是最省力的写法。改成先抽象，第二步就看不见原文了。
 */
const buildPortrait = async (material: MaterialInput): Promise<{ portrait: string; vision: string | null }> => {
  if (material.kind === 'image') {
    const vision = visionModel()
    const portrait = await aliyunChat({
      model: vision,
      system: PORTRAIT_SYSTEM,
      parts: [
        { type: 'image_url', image_url: { url: `data:${material.mediaType};base64,${material.base64}` } },
        { type: 'text', text: PORTRAIT_ASK },
      ],
      // 画像很短，给 1000 就够。给大了模型反而会写长
      maxTokens: 1000,
      temperature: 0.4,
      timeoutMs: 120_000,
    })
    return { portrait, vision }
  }

  // .docx 在这里就地解成文本，和 .txt 走同一条路；解完 base64 就不再被引用
  const text = (material.kind === 'document'
    ? readDocxText(Buffer.from(material.base64, 'base64'))
    : material.text).trim()
  if (!text) throw new TypeError('素材是空的')

  const portrait = await aliyunChat({
    model: textModel(),
    system: PORTRAIT_SYSTEM,
    parts: [{ type: 'text', text: `素材（只读，不要复述）：\n${text.slice(0, TEXT_LIMIT)}` }],
    maxTokens: 1000,
    temperature: 0.4,
    timeoutMs: 120_000,
  })
  return { portrait, vision: null }
}

/* ==================== 第二步：写片段 ==================== */

/**
 * 给模型看的范例（从仓库里现成的片段挑的，逐字照抄）。
 *
 * **这是提高片段质量最有效的一招**，比换更贵的模型管用：模型"照着这个语气写"比
 * "按这个要求写"稳得多 —— 要求是抽象的，范例是具体的。
 */
const GENRE_EXAMPLE = [
  '=== 类型：玄幻（执笔注意）===',
  '',
  '- 术语必须一致：同一件事全书一个说法。新造的名词在正文里第一次出现时要用一句话说清',
  '- 打斗写过程与代价，不写光效。每一次动用能力都要有可见的损耗',
  '- 境界提升要落在具体变化上（能打多远的、能扛多重），不要只写"更强了"',
].join('\n')

const STYLE_EXAMPLE = [
  '=== 文风：冷峻克制===',
  '',
  '句子：偏短。动作与对白交替推进，很少用复合长句。删掉所有"他觉得"类的主观描述——只写他做了什么。',
  '叙述距离：贴着人物的眼睛，但不解释。人物不知道的事，叙述者也不能知道。',
  '节奏：该快的地方只用一句话。该停的地方可以停住，不急着往下推。',
  '禁止：情绪直陈（"她很难过"）；解释性收束（"他终于明白了"）；为了显得深刻而写的抽象名词（命运、执念、救赎）；连续三段同句式。',
  '该做的：让读者从动作和沉默里读出情绪。人物做了什么比人物想了什么更重要。',
].join('\n')

/**
 * 片段标题行里括号里的说法 —— 与仓库里现成片段的写法对齐
 * （`=== 类型：历史（两难的形式）===`、`=== 文风：冷峻克制（润色）===`）。
 * 文风只有 writer / polisher 两片，且 writer 那一片没有括号。
 */
const GENRE_HEADERS: Record<AgentKey, string> = {
  'story-planner': '（世界观规则）',
  character: '（人物位）',
  location: '（地点）',
  architect: '（卷结构）',
  actor: '（两难的形式）',
  writer: '（执笔注意）',
  polisher: '（润色注意）',
}

const STYLE_HEADERS: Partial<Record<AgentKey, string>> = { writer: '', polisher: '（润色）' }

const buildWriterSystem = (): string => {
  // ⚠️ 值里必须把"标题行 + 空行 + 正文"三件事一起示范出来。
  // 只给标题行的话，模型会把标题行当成整个值，于是 9 个片段全是光标题没有内容 ——
  // 实测踩过：5.9 秒返回，每片都只有一行 === 类型：xxx（…）===。
  const headerLines = (dimension: '类型' | '文风', headers: Partial<Record<AgentKey, string>>): string =>
    DIMENSION_AGENTS[dimension]
      .map((agent) =>
        `      "${agent}": "=== ${dimension}：<名字>${headers[agent] ?? ''}===\\n\\n<这一片的正文：3~6 条，一条一行，每条都可执行或可检查>"`)
      .join(',\n')

  return [
    '你是中文长篇小说的设定编辑。读一份素材画像，产出**一个类型**和**一个文风**。',
    '',
    '两个维度是正交的，职责不许互换：',
    '- 类型回答"这个世界有什么、冲突从哪来、读者期待什么"——规则、因果、专名约束、常见失误。',
    '- 文风回答"同一件事用什么声音讲"——句式、叙述距离、节奏、词语偏好、常见失误。',
    '- **文风片段里不许出现题材家具**。写冷峻不等于写悬疑；冷峻的都市和冷峻的武侠是两种东西。',
    '- **类型片段里不许写剧情草稿**。它是题材约束，不是故事。',
    '',
    '硬性要求：',
    '1. 每条都写成**可执行的规则或可检查的反例**。不许写"有电影感""更宏大""更有张力"这类形容词。',
    '2. 中文。不要 AI 腔：不写"不由得""殊不知""仿佛""不禁"，不直陈情绪（"他感到恐惧"），',
    '   不用破折号，不用"不是A而是B"的对照壳，不写"从……到……"式的虚假范围。',
    '3. **每个片段的值 = 标题行 + 一个空行 + 正文**，缺正文不算写完。',
    '   标题行的括号里放注入对象：类型各片见下面的 JSON 模板；文风 writer 的标题行没有括号、polisher 有（润色）。',
    '4. 每片正文 3~6 条，短句，一条一个判据。不要写导语，不要写总结段。',
    '5. **规则要对整个题材/文风通用**。素材只用来判断"这是什么题材、该配什么文风"，',
    '   **不是要被复述进片段里** —— 不许把素材里的具体人物、地名、数字、专名、道具、原句写进规则。',
    '   写的是"这个题材该怎么写"，不是"这一篇该怎么写"。这一条最容易写坏，对照看：',
    '     错：所有数字必须精确：十九起、三点整、一盏一盏',
    '     对：数字要给到角色能感知的精度，不用"几起""陆续"这类模糊量词',
    '     错：把"抬头看了一眼墙上的钟"写成"抬头看钟"',
    '     对：删掉状语，动作只留动词；一个动作不拆成两句',
    '6. 名字：2~6 个汉字，不含标点、不含点号、不含空格。类型名字与文风名字不能相同。',
    '7. 举例要克制。**不许发明伪精确的度量** —— 下面这类一律不许出现：',
    '   "眼球右旋十二度""灰度值47""镜头焦距固定在1.5米""耳道内压力变化""视网膜焦距三点五米"。',
    '   它们既不可执行、也不像人写的规则，只是在冒充精确，写出来反而是噪声。',
    '8. **举例的正面写法里不许出现数字**（0.5厘米、10厘米、2:17、0.4秒 一律不要）。',
    '   模型很容易把"具体"理解成"带数字"，于是凭空编出计量 —— 那是假的精确。',
    '   要具体就具体在**动作、物件、因果**上："不写他很生气，写他把杯子放回桌上时用了力"。',
    '',
    '范例（类型，摘自现有片段）：',
    GENRE_EXAMPLE,
    '',
    '范例（文风，摘自现有片段）：',
    STYLE_EXAMPLE,
    '',
    '只输出一个 JSON 对象，不要任何解释、不要代码块围栏。结构：',
    '{',
    '  "genre": {',
    '    "name": "类型名",',
    '    "fragments": {',
    headerLines('类型', GENRE_HEADERS),
    '    }',
    '  },',
    '  "style": {',
    '    "name": "文风名",',
    '    "fragments": {',
    headerLines('文风', STYLE_HEADERS),
    '    }',
    '  }',
    '}',
  ].join('\n')
}

/* ==================== 解析与兜底 ==================== */

/** 从模型输出里抠出 JSON。模型经常裹一层代码块围栏，或者前后带一句废话 */
const extractJson = (raw: string): unknown => {
  const withoutFence = raw.replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/, '').trim()
  const candidates = [withoutFence]
  const start = withoutFence.indexOf('{')
  const end = withoutFence.lastIndexOf('}')
  if (start >= 0 && end > start) candidates.push(withoutFence.slice(start, end + 1))

  for (const text of candidates) {
    try {
      return JSON.parse(text)
    } catch {
      // 换下一个候选
    }
  }
  throw new Error(`模型没吐出可解析的 JSON。原样开头：${raw.slice(0, 200)}`)
}

const NAME_MAX = 40

/**
 * 名字要当目录名用，所以按 `skills/manage.ts` 的同一套规矩先收拾一遍。
 *
 * **这里只收拾、不抛错**：名字不合法就退回一个能用的默认名，让人在前端改，
 * 而不是让整次生成白跑 —— 素材读图和写 9 个片段的代价比一个名字大得多。
 */
const sanitizeName = (raw: unknown, fallback: string): { name: string; note?: string } => {
  const original = typeof raw === 'string' ? raw.trim() : ''
  const cleaned = original
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\./g, '')
    .replace(/[\u0000-\u001f]/g, '')
    .trim()
    .slice(0, NAME_MAX)

  if (!cleaned) return { name: fallback, note: original ? `原名「${original}」不能作目录名，已改为「${fallback}」` : undefined }
  if (cleaned !== original) return { name: cleaned, note: `原名「${original}」不能作目录名，已改为「${cleaned}」` }
  return { name: cleaned }
}

const fragmentsOf = (raw: unknown, agents: readonly AgentKey[]): Partial<Record<AgentKey, string>> => {
  const source = (raw ?? {}) as Record<string, unknown>
  const result: Partial<Record<AgentKey, string>> = {}
  for (const agent of agents) {
    const value = source[agent]
    // 空片段不收：写一个空的 writer.md 和没有 writer.md 是两回事
    if (typeof value === 'string' && value.trim()) result[agent] = value.trim()
  }
  return result
}

const readFlavor = (raw: unknown, agents: readonly AgentKey[], fallbackName: string): GeneratedFlavor => {
  const source = (raw ?? {}) as Record<string, unknown>
  const { name, note } = sanitizeName(source.name, fallbackName)
  const fragments = fragmentsOf(source.fragments, agents)
  if (Object.keys(fragments).length === 0) throw new Error(`模型没写出「${fallbackName}」的任何片段`)
  return { name, fragments, ...(note ? { nameNote: note } : {}) }
}

/* ==================== 对外唯一入口 ==================== */

export const generateFlavorFromMaterial = async (material: MaterialInput): Promise<GenerationResult> => {
  const { portrait, vision } = await buildPortrait(material)

  const reply = await aliyunChat({
    model: textModel(),
    system: buildWriterSystem(),
    parts: [{ type: 'text', text: `素材画像（只读，不是让你复述它）：\n${portrait}` }],
    // 9 个片段，给足上限。截断出来的半截 JSON 读着还挺完整，所以宁可给大
    maxTokens: 8192,
    temperature: 0.8,
    timeoutMs: 300_000,
  })

  const parsed = extractJson(reply) as { genre?: unknown; style?: unknown }

  return {
    genre: readFlavor(parsed?.genre, DIMENSION_AGENTS['类型'], '类型候选'),
    style: readFlavor(parsed?.style, DIMENSION_AGENTS['文风'], '文风候选'),
    portrait,
    models: { vision, text: textModel() },
  }
}

import { loadAgentEnv } from './env'

loadAgentEnv()

/**
 * 阿里云百炼 —— **OpenAI 兼容模式**，用原生 fetch 调。
 *
 * ============================ 为什么不用 @langchain/openai ============================
 *
 * 这里只需要一次 POST。视觉的消息体是数组结构（文本 + 图片混排），自己拼比穿过
 * langchain 的类型定义更直白，也省掉为一个功能新增依赖 —— 这个项目一直在压依赖。
 *
 * ============================ 域名坑（实测踩过） ============================
 *
 * 百炼控制台会给出一个业务空间专属域名
 * `https://ws-xxxxxxxx.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`，
 * 同一个 key 打到这个域名上，两个 chat 端点都回
 * `{"code":"Endpoint.AccessDenied","message":"Workspace endpoint access denied."}`
 * （而 `/models` 却是 200，很容易误判成 key 坏了）。
 *
 * **能用的地址是公共域名** `https://dashscope.aliyuncs.com/compatible-mode/v1`。
 *
 * ============================ 与 create_model.ts 的分工 ============================
 *
 * `create_model.ts` 走 langchain，是**写作链路**（writer / polisher 那些 agent）在用的；
 * 这里只服务"素材 → 类型/文风片段"这条管理侧链路，两者互不影响。
 * 共用的是同一份 `agent/.env` 解析。
 */

const DEFAULT_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1'

const apiKey = (): string => process.env.ALIYUN_API_KEY ?? ''

const baseUrl = (): string => (process.env.ALIYUN_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, '')

/**
 * 图片素材走视觉模型，文本素材走文本模型。
 * **两个模型名都从 env 来** —— 想从 plus 降到 flash 省钱，改 `.env` 一行，代码不动。
 */
export const visionModel = (): string => process.env.ALIYUN_VL_MODEL ?? 'qwen3-vl-plus'
export const textModel = (): string => process.env.ALIYUN_TEXT_MODEL ?? 'qwen-plus'

export type AliyunContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

export type AliyunChatOptions = {
  model: string
  /** 角色与规则。放 system 而不是拼进 user，模型对它的服从度更高 */
  system?: string
  parts: AliyunContentPart[]
  maxTokens?: number
  temperature?: number
  timeoutMs?: number
}

type ChatPayload = {
  choices?: Array<{ message?: { content?: unknown } }>
  error?: { message?: string }
  message?: string
}

/**
 * 调一次 `/chat/completions`，返回助手文本。
 *
 * 失败一律抛错并带上提供方的原话 —— "403 access denied" 这种必须原样透出来，
 * 换成"调用失败"就等于把唯一的线索扔了。
 */
export const aliyunChat = async (options: AliyunChatOptions): Promise<string> => {
  const key = apiKey()
  if (!key) throw new Error('缺少 ALIYUN_API_KEY：请在 agent/.env 里配置')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 180_000)

  try {
    const response = await fetch(`${baseUrl()}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: options.model,
        messages: [
          ...(options.system ? [{ role: 'system', content: options.system }] : []),
          { role: 'user', content: options.parts },
        ],
        temperature: options.temperature ?? 0.7,
        // 参数名是 max_tokens（不是 maxTokens）。**必须显式给**：
        // 一次要吐 9 个片段，不给上限会被中途截断，而截断出来的半截 JSON 读着还挺完整。
        max_tokens: options.maxTokens ?? 8192,
        stream: false,
      }),
      signal: controller.signal,
    })

    const payload = (await response.json().catch(() => null)) as ChatPayload | null

    if (!response.ok) {
      const detail = payload?.error?.message ?? payload?.message ?? `HTTP ${response.status}`
      throw new Error(`百炼调用失败（${response.status}）：${detail}`)
    }

    const content = payload?.choices?.[0]?.message?.content
    if (typeof content !== 'string' || !content.trim()) throw new Error('百炼返回了空内容')

    return content
  } finally {
    clearTimeout(timer)
  }
}

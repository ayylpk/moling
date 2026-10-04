export type SiliconFlowEmbeddingConfig = {
  apiKey?: string
  baseUrl?: string
  model?: string
  dimensions?: number
  timeoutMs?: number
}

export type EmbeddingClient = {
  embed(input: string[]): Promise<number[][]>
}

const DEFAULT_BASE_URL = 'https://api.siliconflow.cn/v1'
const DEFAULT_MODEL = 'Qwen/Qwen3-Embedding-0.6B'
const DEFAULT_DIMENSIONS = 1024

export const createSiliconFlowEmbeddingClient = (config: SiliconFlowEmbeddingConfig = {}, fetcher: typeof fetch = fetch): EmbeddingClient => {
  const apiKey = config.apiKey ?? process.env.SILICONFLOW_API_KEY
  const baseUrl = (config.baseUrl ?? process.env.SILICONFLOW_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
  const model = config.model ?? process.env.SILICONFLOW_EMBEDDING_MODEL ?? DEFAULT_MODEL
  const dimensions = config.dimensions ?? Number(process.env.SILICONFLOW_EMBEDDING_DIMENSIONS ?? DEFAULT_DIMENSIONS)
  const timeoutMs = config.timeoutMs ?? Number(process.env.SILICONFLOW_EMBEDDING_TIMEOUT_MS ?? 15000)

  return {
    async embed(input) {
      if (input.length === 0) return []
      if (!apiKey) throw new Error('SILICONFLOW_API_KEY is not configured')
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const response = await fetcher(`${baseUrl}/embeddings`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, input, encoding_format: 'float', dimensions }),
          signal: controller.signal,
        })
        if (!response.ok) throw new Error(`SiliconFlow Embedding failed (${response.status}): ${(await response.text()).slice(0, 300)}`)
        const payload = await response.json() as { data?: Array<{ index?: number; embedding?: number[] }> }
        const vectors = (payload.data ?? []).sort((left, right) => (left.index ?? 0) - (right.index ?? 0)).map((item) => item.embedding)
        if (vectors.length !== input.length || vectors.some((vector) => !Array.isArray(vector) || vector.length === 0)) throw new Error(`SiliconFlow Embedding expected ${input.length} vectors, received ${vectors.length}`)
        return vectors as number[][]
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') throw new Error(`SiliconFlow Embedding timed out after ${timeoutMs}ms`)
        throw error
      } finally { clearTimeout(timeout) }
    },
  }
}

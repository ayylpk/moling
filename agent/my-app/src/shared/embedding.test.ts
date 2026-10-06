import { describe, expect, test } from 'bun:test'
import { createSiliconFlowEmbeddingClient } from './embedding'

describe('SiliconFlow embedding client', () => {
  test('sends the configured model and parses vectors', async () => {
    let sentBody: Record<string, unknown> | undefined
    const client = createSiliconFlowEmbeddingClient({ apiKey: 'test-key' }, async (_input, init) => {
      sentBody = JSON.parse(String(init?.body)) as Record<string, unknown>
      return Response.json({ data: [{ index: 0, embedding: [0.25, 0.75] }] })
    })

    const vectors = await client.embed(['沈砚观察局势'])
    expect(sentBody).toEqual({ model: 'Qwen/Qwen3-Embedding-0.6B', input: ['沈砚观察局势'], encoding_format: 'float', dimensions: 1024 })
    expect(vectors).toEqual([[0.25, 0.75]])
  })

  test('rejects an unsuccessful provider response', async () => {
    const client = createSiliconFlowEmbeddingClient({ apiKey: 'test-key' }, async () => new Response('invalid key', { status: 401 }))
    await expect(client.embed(['query'])).rejects.toThrow('SiliconFlow Embedding failed (401)')
  })

  test('rejects a response with an unexpected vector count', async () => {
    const client = createSiliconFlowEmbeddingClient({ apiKey: 'test-key' }, async () => Response.json({ data: [] }))
    await expect(client.embed(['one input'])).rejects.toThrow('expected 1 vectors, received 0')
  })
})

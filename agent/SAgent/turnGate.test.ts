import { describe, expect, test } from 'bun:test'
import { ToolMessage } from '@langchain/core/messages'
import { resetTurnGate, turnGate } from './turnGate'

/**
 * 阶段闸门的行为测试 —— 「一轮只做一个生成阶段」不能只靠提示词。
 *
 * 全部用直调 wrapToolCall 的方式测，不起模型：handler 是假的，
 * 记录"它有没有被调到"就知道闸门是放行还是拦截。
 */

const middleware = turnGate() as unknown as {
  wrapToolCall: (
    request: unknown,
    handler: () => Promise<ToolMessage>,
  ) => Promise<unknown>
}

/** 跑一次工具调用：handler 返回 'ok'，并记录自己有没有被调到。 */
const run = async (toolName: string, turnId?: string, novelId?: number) => {
  let handlerCalled = false
  const result = await middleware.wrapToolCall(
    {
      toolCall: { id: 'tc1', name: toolName },
      tool: { name: toolName },
      runtime: {
        configurable: {
          ...(novelId === undefined ? {} : { novelId }),
          ...(turnId === undefined ? {} : { turnId }),
        },
      },
    },
    async () => { handlerCalled = true; return new ToolMessage({ content: 'ok', tool_call_id: 'tc1' }) },
  )
  return { handlerCalled, result }
}

const contentOf = (result: unknown): string => String((result as ToolMessage).content ?? '')

describe('turnGate（一轮一个生成阶段）', () => {
  test('第一个生成动作放行，同一轮的第二个生成动作被拦下', async () => {
    resetTurnGate()
    const turn = 'turn-a'
    const first = await run('generate_world', turn)
    expect(first.handlerCalled).toBe(true)

    const second = await run('generate_outline', turn)
    expect(second.handlerCalled).toBe(false)
    expect((second.result as ToolMessage).status).toBe('error')
    expect(contentOf(second.result)).toContain('一轮只允许一个生成阶段')
  })

  test('同一轮：生成之后调保存工具被拦（采纳必须等作者确认的下一轮）', async () => {
    resetTurnGate()
    const turn = 'turn-b'
    await run('generate_world', turn)
    const save = await run('save_world', turn)
    expect(save.handlerCalled).toBe(false)
    expect(contentOf(save.result)).toContain('生成与落库不能在同一轮完成')
  })

  test('新一轮不受上一轮影响：隔轮的生成照常放行', async () => {
    resetTurnGate()
    await run('generate_world', 'turn-c1')
    const next = await run('generate_world', 'turn-c2')
    expect(next.handlerCalled).toBe(true)
  })

  test('没有待审核草案时，保存工具被拦（正式表不能凭空写）', async () => {
    resetTurnGate()
    // novelId=999999 不存在：闸门查不到草案 → 拦截（fail-closed）
    const save = await run('save_world', 'turn-d', 999_999)
    expect(save.handlerCalled).toBe(false)
    expect(contentOf(save.result)).toContain('没有待审核的草案可保存')
  })

  test('没有 turnId 的调用路径不拦（闸门只管对话轮次）', async () => {
    resetTurnGate()
    const first = await run('generate_world')
    expect(first.handlerCalled).toBe(true)
    const second = await run('generate_outline')
    expect(second.handlerCalled).toBe(true)
  })
})

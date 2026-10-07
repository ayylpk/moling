import { describe, expect, test } from 'bun:test'

import { NO_AI_VOICE } from './index'
import {
  assertDimensionMatches,
  composePrompt,
  describeComposition,
  FLAVOR_SYNC_RULES,
  GENRE_DIR,
  listGenres,
  listStyles,
  STYLE_DIR,
} from './loader'

/**
 * 拼接器的测试重点不是"文件读到了"（那是文件系统的事），而是三件事：
 *
 *   1. **文风/类型确实会改变提示词** —— 换一种文风，writer 拿到的提示词必须不同。
 *      不变就等于没接上，而它不会报错。
 *   2. **红线永远在最后且永远在** —— 不管选了什么风格，`NO_AI_VOICE` 的内容都在，
 *      而且排在最后（排在中间会被后面的片段稀释）。
 *   3. **自由文本不炸** —— 作者写"清冷的""90年代港风"这类不在目录里的词时，
 *      提示词照样拼得出来，只是少一段。
 */

const BASE = 'BASE_PROMPT_MARKER'

describe('维度清单', () => {
  test('至少有一种文风与一种类型可选（否则前端没东西可列）', () => {
    expect(listStyles().length).toBeGreaterThan(0)
    expect(listGenres().length).toBeGreaterThan(0)
  })

  test('清单不含 README 之类的文件，只含目录名', () => {
    for (const name of listStyles()) expect(name).not.toContain('.')
  })
})

describe('composePrompt：文风与类型会改变提示词', () => {
  test('同一 agent 在不同文风下提示词不同', () => {
    const [a, b] = listStyles()
    const left = composePrompt(BASE, 'writer', a, '', NO_AI_VOICE)
    const right = composePrompt(BASE, 'writer', b, '', NO_AI_VOICE)
    expect(left).not.toBe(right)
    expect(left).toContain(BASE)
    expect(right).toContain(BASE)
  })

  test('同一 agent 在不同类型下提示词不同', () => {
    const [a, b] = listGenres()
    expect(composePrompt(BASE, 'architect', '', a, NO_AI_VOICE))
      .not.toBe(composePrompt(BASE, 'architect', '', b, NO_AI_VOICE))
  })

  test('文风与类型**同时**给上，两段都在（它们正交，不互相取代）', () => {
    const composed = composePrompt(BASE, 'writer', listStyles()[0]!, listGenres()[0]!, NO_AI_VOICE)
    expect(composed).toContain(BASE)
    expect(composed).toContain(NO_AI_VOICE)
    // 片段数 = 1(base) + 1(类型) + 1(文风) + 1(红线)。
    // 不能用 split('\n\n') 数 —— 片段内容本身有分段，那会数出一个假的大数。
    // 改成验证"顺序"：base 在最前、红线在最后，两段片段都在它们之间。
    const head = composed.indexOf(BASE)
    const tail = composed.indexOf(NO_AI_VOICE)
    expect(head).toBe(0)
    expect(tail).toBeGreaterThan(head)
    expect(composed.slice(head, tail)).toContain('=== 文风：')
    expect(composed.slice(head, tail)).toContain('=== 类型：')
  })

  test('不选文风与类型时，少的只是那两段片段；同步契约与红线照旧都在', () => {
    // 同步契约（FLAVOR_SYNC_RULES）是**常驻**的：它规定"类型与文风都必须生效、
    // 且不许覆盖世界观与章纲"，这与选了哪个维度无关，所以一个维度都没选时它也在。
    // 少的只有 类型片段 与 文风片段 这两段。
    expect(composePrompt(BASE, 'writer', '', '', NO_AI_VOICE))
      .toBe([BASE, FLAVOR_SYNC_RULES, NO_AI_VOICE].join('\n\n'))
  })

  test('undefined 与空串等价（前端可能传 undefined）', () => {
    expect(composePrompt(BASE, 'writer', undefined, undefined, NO_AI_VOICE))
      .toBe(composePrompt(BASE, 'writer', '', '', NO_AI_VOICE))
  })
})

describe('红线永远在最后', () => {
  test('选任何文风与类型，NO_AI_VOICE 都在', () => {
    for (const style of listStyles()) {
      for (const genre of listGenres().slice(0, 2)) {
        const composed = composePrompt(BASE, 'writer', style, genre, NO_AI_VOICE)
        expect(composed).toContain(NO_AI_VOICE)
      }
    }
  })

  test('NO_AI_VOICE 是最后一段（排在中间会被片段"稀释"）', () => {
    const composed = composePrompt(BASE, 'writer', listStyles()[0]!, listGenres()[0]!, NO_AI_VOICE)
    expect(composed.endsWith(NO_AI_VOICE)).toBe(true)
  })
})

describe('自由文本不炸（作者可以随便写）', () => {
  test('不存在的文风名：少一段，照样拼得出来', () => {
    const composed = composePrompt(BASE, 'writer', '我自己定义的节奏', '', NO_AI_VOICE)
    expect(composed).toBe([BASE, FLAVOR_SYNC_RULES, NO_AI_VOICE].join('\n\n'))
  })

  test('不存在的类型名：同上', () => {
    expect(composePrompt(BASE, 'writer', '', '90年代港风', NO_AI_VOICE))
      .toBe([BASE, FLAVOR_SYNC_RULES, NO_AI_VOICE].join('\n\n'))
  })

  test('两边都不存在也照样拼得出来，不抛错', () => {
    expect(() => composePrompt(BASE, 'polisher', '不存在A', '不存在B', NO_AI_VOICE)).not.toThrow()
  })

  test('带空格的文风名会被 trim 后匹配（作者手滑打空格不算错）', () => {
    const style = listStyles()[0]!
    expect(composePrompt(BASE, 'writer', `  ${style}  `, '', NO_AI_VOICE))
      .toBe(composePrompt(BASE, 'writer', style, '', NO_AI_VOICE))
  })
})

describe('assertDimensionMatches：建书时拦住拼错的目录名', () => {
  test('命中现有目录名 → ok，且 matched 就是它', () => {
    const style = listStyles()[0]!
    const result = assertDimensionMatches(STYLE_DIR, style)
    expect(result.ok).toBe(true)
    expect(result.matched).toBe(style)
    expect(Array.isArray(result.known)).toBe(true)
    expect(result.known).toContain(style)
  })

  test('空值 → ok（没选也是一种选择）', () => {
    expect(assertDimensionMatches(STYLE_DIR, '').ok).toBe(true)
    expect(assertDimensionMatches(GENRE_DIR, undefined).ok).toBe(true)
  })

  test('拼错的字 → ok=false，known 里有正确的字可对照', () => {
    // 「冷俊克制」是「冷峻克制」的常见错字。两种情况都该 ok=false：
    // 目录里没有「冷俊克制」这个可选项，作者写它就是没选上。
    const result = assertDimensionMatches(STYLE_DIR, '冷俊克制')
    expect(result.ok).toBe(false)
    expect(result.matched).toBeNull()
    if (listStyles().includes('冷峻克制')) expect(result.known).toContain('冷峻克制')
  })
})

describe('describeComposition：调试用', () => {
  test('拼得出 agent + 两个维度，且标出缺哪个片段', () => {
    const described = describeComposition('writer', listStyles()[0]!, listGenres()[0]!)
    expect(described).toContain('writer')
    expect(described).toContain(listStyles()[0]!)
    expect(described).toContain(listGenres()[0]!)
  })

  test('文风只有 writer/polisher 片段时，给世界观 agent 会标出"无片段"', () => {
    const described = describeComposition('story-planner', listStyles()[0]!, '')
    expect(described).toContain('无片段')
  })
})

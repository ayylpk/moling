import { describe, expect, test } from 'bun:test'
import { diagnoseRhythm, paragraphChangeRate } from './chapterStandalone'

/**
 * 第二遍润色的两个量化输入。
 *
 * 用例直接取自《111》第 1 章的真实病灶：15 处直角引号、30+ 个几乎等长的短段、
 * 一次只动了两处标点的"润色"（段落级改写率 6%）。这三个数字就是当时那章
 * "读着像 AI 却查不出哪里错"的全部来源 —— 把它们钉死在这里，防止回退。
 */
describe('diagnoseRhythm（节奏靶子清单）', () => {
  test('直角引号要被点名，并给出处数', () => {
    const targets = diagnoseRhythm('「吃了吗。」\n\n「吃了。」\n\n他们出了门。')
    expect(targets.some((t) => t.includes('直角引号'))).toBe(true)
  })

  test('对白全用 “” 时不报引号问题', () => {
    const targets = diagnoseRhythm('“吃了吗。”\n\n“吃了。”\n\n他们出了门。')
    expect(targets.some((t) => t.includes('直角引号'))).toBe(false)
  })

  test('连续三段长度接近 → 点名等长段落', () => {
    const text = [10, 11, 12, 40].map((n) => '字'.repeat(n)).join('\n\n')
    const targets = diagnoseRhythm(text)
    expect(targets.some((t) => t.includes('长度几乎一样'))).toBe(true)
  })

  test('长短交错的正常稿子 → 不报节奏问题', () => {
    const text = ['“走。”', '他把伞收了，水顺着伞尖在门口积了一小滩，还没来得及擦就被踩开了。', '“等等。”', '字'.repeat(60)].join('\n\n')
    const targets = diagnoseRhythm(text)
    expect(targets.length).toBe(0)
  })

  test('连续三行等长的对白要被点名', () => {
    const text = ['“吃了。”', '“喝了。”', '“走了。”', '他们出了门。'].join('\n\n')
    const targets = diagnoseRhythm(text)
    expect(targets.some((t) => t.includes('等长对白'))).toBe(true)
  })
})

describe('paragraphChangeRate（按段落计的改写率）', () => {
  const draft = ['他说他来过。', '她说她没看见。', '门口的灯亮着。', '雪还没化。'].join('\n\n')

  test('一字未改 → 0', () => {
    expect(paragraphChangeRate(draft, draft)).toBe(0)
  })

  test('只动两处标点、字数不变 → 仍然是"没润"（这是当时漏网的形态）', () => {
    // 模拟"润色"：把第 1、2 段里的一个逗号换成句号 —— 字数相同、内容几乎相同
    const polished = ['他说他来过。', '她说她没看见。', '门口的灯亮着。', '雪还没化。'].join('\n\n')
    expect(paragraphChangeRate(draft, polished)).toBe(0)
  })

  test('换了一种标点导致段落内容不同 → 按改动段计', () => {
    const polished = ['他说他来过，又走了。', '她说她没看见。', '门口的灯亮着。', '雪还没化。'].join('\n\n')
    expect(paragraphChangeRate(draft, polished)).toBe(0.25)
  })

  test('全部段落都改了 → 1', () => {
    const polished = ['甲', '乙', '丙', '丁'].join('\n\n')
    expect(paragraphChangeRate(draft, polished)).toBe(1)
  })

  test('段落数量变化也计入（合并碎段是节奏遍的合法动作）', () => {
    const polished = ['他说他来过。她说她没看见。', '门口的灯亮着。', '雪还没化。'].join('\n\n')
    expect(paragraphChangeRate(draft, polished)).toBeGreaterThan(0)
  })
})

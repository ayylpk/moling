import { describe, expect, test } from 'bun:test'
import { composeChapterTxt, type ExportChapter } from './chapterTxt'

/** 纯函数，不需要库也不需要文件 —— 所以这里能把"导出成什么样"钉死 */
const chapter = (idx: number, title: string, text: string | null, stage: ExportChapter['stage']): ExportChapter => ({ idx, title, text, stage })

const book = (chapters: ExportChapter[], novelTitle = '墨灵') => composeChapterTxt({ novelTitle, chapters })

describe('composeChapterTxt：正文', () => {
  test('单章：标题行 + 空行 + 正文', () => {
    const result = book([chapter(1, '雨夜', '值班室的电话响了。', 'final')])
    expect(result.content).toBe('第1章 雨夜\n\n值班室的电话响了。\n')
  })

  test('多章按章号排序，章与章之间空两行', () => {
    const result = book([
      chapter(2, '第二', '乙', 'final'),
      chapter(1, '第一', '甲', 'final'),
    ])
    expect(result.content).toBe('第1章 第一\n\n甲\n\n\n第2章 第二\n\n乙\n')
  })

  test('标题为空时只留章号，不留尾随空格', () => {
    expect(book([chapter(7, '', '正文', 'final')]).content).toBe('第7章\n\n正文\n')
  })

  test('章节还没有正文时写明，而不是静默给一段空白', () => {
    const result = book([chapter(1, '雨夜', null, null)])
    expect(result.content).toContain('（本章尚无正文）')
    expect(result.content).toContain('以下章节还没有正文：第 1 章。')
  })

  test('正文两端空白被收掉', () => {
    expect(book([chapter(1, '雨夜', '\n\n  正文  \n\n', 'final')]).content).toBe('第1章 雨夜\n\n正文\n')
  })
})

describe('composeChapterTxt：初稿要写在文件里', () => {
  test('全是终稿时不加说明块（一个只会被删掉的说明是噪声）', () => {
    const result = book([chapter(1, '甲', '正文', 'final')])
    expect(result.content).not.toContain('【导出说明】')
  })

  test('混入初稿时，说明块点名是哪几章', () => {
    const result = book([
      chapter(1, '甲', '正文', 'final'),
      chapter(2, '乙', '草稿', 'draft'),
      chapter(3, '丙', '草稿', 'draft'),
    ])
    expect(result.content).toContain('这里用的是初稿：第 2、3 章。')
    // 说明在最前面，删起来方便
    expect(result.content.startsWith('【导出说明】')).toBe(true)
  })

  test('初稿与无正文同时存在时两条都说', () => {
    const result = book([
      chapter(1, '甲', '草稿', 'draft'),
      chapter(2, '乙', null, null),
    ])
    expect(result.content).toContain('初稿：第 1 章。')
    expect(result.content).toContain('没有正文：第 2 章。')
  })
})

describe('composeChapterTxt：文件名', () => {
  test('单章带书名与章名', () => {
    expect(book([chapter(3, '雨夜', 'x', 'final')]).filename).toBe('《墨灵》第3章 雨夜')
  })

  test('连续多章写成区间', () => {
    const result = book([chapter(1, '甲', 'x', 'final'), chapter(2, '乙', 'x', 'final'), chapter(3, '丙', 'x', 'final')])
    expect(result.filename).toBe('《墨灵》第1-3章')
  })

  test('不连续时不写区间（区间会骗人）', () => {
    const result = book([chapter(1, '甲', 'x', 'final'), chapter(2, '乙', 'x', 'final'), chapter(4, '丁', 'x', 'final')])
    expect(result.filename).toBe('《墨灵》第1、2、4章')
  })

  test('选得太多时只写数量，不然文件名会长得没法看', () => {
    const many = [1, 2, 3, 4, 5, 7].map((idx) => chapter(idx, `第${idx}节`, 'x', 'final'))
    expect(book(many).filename).toBe('《墨灵》选中 6 章')
  })

  test('章名里的非法字符被清掉，文件名不会因此建不出来', () => {
    const result = book([chapter(1, '上/下: 雨*夜?', 'x', 'final')])
    expect(result.filename).toBe('《墨灵》第1章 上下 雨夜')
    expect(result.filename).not.toMatch(/[\\/:*?"<>|]/)
  })

  test('书名为空时不留一个空书名括号', () => {
    expect(book([chapter(1, '甲', 'x', 'final')], '').filename).toBe('《未命名》第1章 甲')
  })
})

describe('composeChapterTxt：边界', () => {
  test('一章都没有时抛错，而不是导出一个空文件', () => {
    expect(() => book([])).toThrow(/没有要导出的章节/)
  })

  test('同一章传了两次也只出现一次（按章号去重由调用方保证，这里不静默合并）', () => {
    // 这条是记录当前行为：传两个同 idx 的章节会输出两遍，调用方负责去重
    const result = book([chapter(1, '甲', 'x', 'final'), chapter(1, '甲', 'x', 'final')])
    expect(result.content.match(/第1章/g)?.length).toBe(2)
  })
})

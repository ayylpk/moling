/**
 * 把若干章拼成一份可以下载的 txt。
 *
 * **纯函数**：不碰库、不碰文件、不碰时间。所以它能被直接测，也就能把
 * "导出成什么样"这件事从路由和 db 里摘出来单独看。
 */

export type ExportChapter = {
  idx: number
  title: string
  /** 这一章实际用的正文。null = 还没有正文 */
  text: string | null
  /** 用的是哪一版。null = 还没有正文 */
  stage: 'final' | 'draft' | null
}

export type ComposedExport = {
  /** 建议的文件名。**不含扩展名** —— .txt 由路由拼进 Content-Disposition */
  filename: string
  content: string
}

/** 文件名里不能出现的字符（Windows 最严），外加换行与制表 */
const ILLEGAL_IN_FILENAME = /[\\/:*?"<>|\r\n\t]/g

/** 文件名长度上限。Windows 全路径 260 是硬的，这里只管名字这一段 */
const FILENAME_MAX = 80

const sanitize = (value: string): string => value.replace(ILLEGAL_IN_FILENAME, '').trim()

/** `第 3、7 章` / `第 3 章` —— 给导出说明用 */
const chapterRefs = (indexes: number[]): string => `第 ${indexes.join('、')} 章`

/**
 * 章节标题行。标题可能为空（只落了章纲还没起名），那就只有章号，不留尾随空格。
 */
const headingOf = (chapter: ExportChapter): string =>
  chapter.title ? `第${chapter.idx}章 ${chapter.title}` : `第${chapter.idx}章`

const filenameOf = (novelTitle: string, chapters: ExportChapter[]): string => {
  const book = `《${sanitize(novelTitle) || '未命名'}》`
  const indexes = chapters.map((chapter) => chapter.idx)

  if (indexes.length === 1) {
    const only = chapters[0]!
    return sanitize(`${book}第${only.idx}章 ${only.title}`) || `${book}第${only.idx}章`
  }

  // 连续序号才写成区间，否则区间会骗人（1、2、3 是 1-3，1、2、4 不是）
  const continuous = indexes.every((value, position) => position === 0 || value === indexes[position - 1]! + 1)
  if (continuous) return `${book}第${indexes[0]}-${indexes[indexes.length - 1]}章`

  const listed = indexes.length <= 5 ? `第${indexes.join('、')}章` : `选中 ${indexes.length} 章`
  return sanitize(`${book}${listed}`) || `${book}选中 ${indexes.length} 章`
}

/**
 * 拼正文。
 *
 * 头部**只在有话说的时候才写**（有章节用的是初稿、或有章节还没有正文）。
 * 全都齐的时候不加那一段 —— 一个只会被删掉的说明块反而是噪声。
 * 初稿这件事必须写在文件里：不写的话，拿到 txt 的人会以为通篇都是定稿。
 */
export const composeChapterTxt = (options: { novelTitle: string; chapters: ExportChapter[] }): ComposedExport => {
  const chapters = [...options.chapters].sort((left, right) => left.idx - right.idx)
  if (chapters.length === 0) throw new TypeError('没有要导出的章节')

  const draftOnly = chapters.filter((chapter) => chapter.stage === 'draft').map((chapter) => chapter.idx)
  const noText = chapters.filter((chapter) => chapter.stage === null).map((chapter) => chapter.idx)

  const notes: string[] = []
  if (draftOnly.length > 0) notes.push(`以下章节还没有终稿，这里用的是初稿：${chapterRefs(draftOnly)}。`)
  if (noText.length > 0) notes.push(`以下章节还没有正文：${chapterRefs(noText)}。`)

  const head = notes.length > 0 ? `【导出说明】\n${notes.join('\n')}\n\n${'='.repeat(20)}\n\n` : ''
  const body = chapters
    .map((chapter) => `${headingOf(chapter)}\n\n${chapter.text?.trim() || '（本章尚无正文）'}`)
    .join('\n\n\n')

  return {
    filename: filenameOf(options.novelTitle, chapters).slice(0, FILENAME_MAX),
    content: `${head}${body}\n`,
  }
}

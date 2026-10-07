import { inflateRawSync } from 'node:zlib'

/**
 * 从 `.docx` 里取纯文本 —— **零依赖**。
 *
 * `.docx` 本质上就是个 zip，正文在 `word/document.xml`。为了读一个文件引入一整套
 * 文档解析库（连带它的传递依赖），不划算 —— 这里只需要：找到中央目录 → 定位那一个条目
 * → inflateRaw → 剥掉 XML 标签。够用，而且能说清每一行在干什么。
 *
 * **不支持的**：`.doc`（97-2003 的老二进制格式，根本不是 zip）。遇到会明确报错并告诉人
 * 怎么办，而不是抛一个看不懂的异常。
 */

const LOCAL_SIGNATURE = 0x04034b50
const CENTRAL_SIGNATURE = 0x02014b50
const EOCD_SIGNATURE = 0x06054b50

/** EOCD 固定 22 字节 + 最多 65535 字节注释 —— 往回最多扫这么多就能找到它 */
const EOCD_MAX_SCAN = 22 + 0xffff

const findEndOfCentralDirectory = (buf: Buffer): number => {
  const floor = Math.max(0, buf.length - EOCD_MAX_SCAN)
  for (let offset = buf.length - 22; offset >= floor; offset -= 1) {
    if (buf.readUInt32LE(offset) === EOCD_SIGNATURE) return offset
  }
  return -1
}

/** 读一个 zip 条目（按中央目录给的压缩长度截取，不依赖本地头里的长度字段） */
const readEntry = (buf: Buffer, localOffset: number, method: number, compressedSize: number): string => {
  if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== LOCAL_SIGNATURE) {
    throw new TypeError('.docx 的条目头损坏，文件可能没下载完整')
  }
  const nameLength = buf.readUInt16LE(localOffset + 26)
  const extraLength = buf.readUInt16LE(localOffset + 28)
  const start = localOffset + 30 + nameLength + extraLength
  const raw = buf.subarray(start, start + compressedSize)

  if (method === 0) return raw.toString('utf8') // 未压缩
  if (method === 8) return inflateRawSync(raw).toString('utf8') // deflate
  throw new TypeError(`.docx 用了不支持的压缩方式（method=${method}）`)
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
}

const decodeEntities = (text: string): string =>
  text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, entity: string) => {
    try {
      if (entity.startsWith('#x') || entity.startsWith('#X')) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16))
      if (entity.startsWith('#')) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10))
    } catch {
      return whole
    }
    return NAMED_ENTITIES[entity] ?? whole
  })

/**
 * 把 `word/document.xml` 变成可读文本。
 *
 * 只需要三件事：段落收尾变换行、制表符与<w:br/>保留、其余标签全删。
 * 表格单元格之间补一个制表符，否则「姓名」「年龄」两格会粘成一个词。
 */
const extractXmlText = (xml: string): string => {
  const withBreaks = xml
    .replace(/<w:tab\b[^>]*\/?>/g, '\t')
    .replace(/<w:br\b[^>]*\/?>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<\/w:tc>/g, '\t')
    .replace(/<\/w:tr>/g, '\n')

  return decodeEntities(withBreaks.replace(/<[^>]+>/g, ''))
    // 单元格里的段落也会产生换行，落在制表符前面就变成"换行 + 制表符"，
    // 结果表格被拆成两行。分隔符优先：换行贴着制表符时只留制表符。
    .replace(/\n+\t/g, '\t')
    .replace(/\t\n+/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** 传入 .docx 的原始字节，返回正文纯文本 */
export const readDocxText = (input: Uint8Array): string => {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input)

  if (buf.length < 4 || buf.readUInt32LE(0) !== LOCAL_SIGNATURE) {
    throw new TypeError('这个文件不是 .docx。如果是 .doc（97-2003 老格式），请在 Word 里「另存为」成 .docx 再传')
  }

  const eocd = findEndOfCentralDirectory(buf)
  if (eocd < 0) throw new TypeError('.docx 结构不完整：找不到中央目录')

  const entryCount = buf.readUInt16LE(eocd + 10)
  let cursor = buf.readUInt32LE(eocd + 16)

  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > buf.length || buf.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) break
    const method = buf.readUInt16LE(cursor + 10)
    const compressedSize = buf.readUInt32LE(cursor + 20)
    const nameLength = buf.readUInt16LE(cursor + 28)
    const extraLength = buf.readUInt16LE(cursor + 30)
    const commentLength = buf.readUInt16LE(cursor + 32)
    const localOffset = buf.readUInt32LE(cursor + 42)
    const name = buf.toString('utf8', cursor + 46, cursor + 46 + nameLength)

    if (name === 'word/document.xml') {
      const text = extractXmlText(readEntry(buf, localOffset, method, compressedSize))
      if (!text) throw new TypeError('.docx 里没有文字内容')
      return text
    }
    cursor += 46 + nameLength + extraLength + commentLength
  }

  throw new TypeError('.docx 里没找到正文（word/document.xml）')
}

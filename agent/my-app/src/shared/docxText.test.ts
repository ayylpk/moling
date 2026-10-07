import { describe, expect, test } from 'bun:test'
import { deflateRawSync } from 'node:zlib'
import { readDocxText } from './docxText'

/**
 * 这里**自己拼一个 .docx**（zip）当夹具，而不是塞一个二进制文件进仓库：
 *   · 仓库里放一个看不出来源的 .docx，没人知道它里面写了什么，也没法改
 *   · 自己拼的能精确控制"多一个条目""缺 document.xml""不是 zip"这些边界
 * CRC 一律写 0 —— 读取器不校验它（也不该校验：我们的用途是取文字，不是验完整性）。
 */
const buildZip = (entries: Array<{ name: string; content: string }>): Buffer => {
  const parts: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    const raw = Buffer.from(entry.content, 'utf8')
    const compressed = deflateRawSync(raw)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(8, 8) // deflate
    local.writeUInt32LE(compressed.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(name.length, 26)

    const head = Buffer.alloc(46)
    head.writeUInt32LE(0x02014b50, 0)
    head.writeUInt16LE(20, 4)
    head.writeUInt16LE(20, 6)
    head.writeUInt16LE(8, 10) // deflate
    head.writeUInt32LE(compressed.length, 20)
    head.writeUInt32LE(raw.length, 24)
    head.writeUInt16LE(name.length, 28)
    head.writeUInt32LE(offset, 42)

    parts.push(local, name, compressed)
    central.push(head, name)
    offset += 30 + name.length + compressed.length
  }

  const centralBuffer = Buffer.concat(central)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralBuffer.length, 12)
  eocd.writeUInt32LE(offset, 16)

  return Buffer.concat([...parts, centralBuffer, eocd])
}

const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'

const documentXml = (body: string): string =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W_NS}><w:body>${body}</w:body></w:document>`

const paragraph = (text: string): string => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`

describe('readDocxText：从 .docx 里取正文', () => {
  test('取出段落文字，段落之间保留换行', () => {
    const docx = buildZip([
      { name: '[Content_Types].xml', content: '<Types/>' },
      { name: 'word/document.xml', content: documentXml(paragraph('值班室的电话响了') + paragraph('她抬头看钟')) },
    ])

    expect(readDocxText(docx)).toBe('值班室的电话响了\n她抬头看钟')
  })

  test('文档条目在压缩包里排在后面也能找到（靠中央目录，不靠顺序）', () => {
    const docx = buildZip([
      { name: 'docProps/app.xml', content: '<Properties/>' },
      { name: 'word/styles.xml', content: '<styles/>' },
      { name: 'word/document.xml', content: documentXml(paragraph('凌晨三点')) },
      { name: 'word/settings.xml', content: '<settings/>' },
    ])

    expect(readDocxText(docx)).toBe('凌晨三点')
  })

  test('实体解码，且不把 &lt;w:t&gt; 这种转义文本当成标签删掉', () => {
    const docx = buildZip([
      { name: 'word/document.xml', content: documentXml(paragraph('雨 &amp; 灯 &lt;都&gt; 停了')) },
    ])

    expect(readDocxText(docx)).toBe('雨 & 灯 <都> 停了')
  })

  test('表格单元格之间补制表符，不会把两格粘成一个词', () => {
    const table = '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>姓名</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>年龄</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'
    const docx = buildZip([{ name: 'word/document.xml', content: documentXml(table) }])

    expect(readDocxText(docx)).toBe('姓名\t年龄')
  })

  test('未压缩（method=0）的条目也能读', () => {
    const xml = Buffer.from(documentXml(paragraph('存起来的方法不一样')), 'utf8')
    const name = Buffer.from('word/document.xml', 'utf8')
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(0, 8) // stored
    local.writeUInt32LE(xml.length, 18)
    local.writeUInt32LE(xml.length, 22)
    local.writeUInt16LE(name.length, 26)
    const head = Buffer.alloc(46)
    head.writeUInt32LE(0x02014b50, 0)
    head.writeUInt32LE(xml.length, 20)
    head.writeUInt32LE(xml.length, 24)
    head.writeUInt16LE(name.length, 28)
    head.writeUInt32LE(0, 42)
    const eocd = Buffer.alloc(22)
    eocd.writeUInt32LE(0x06054b50, 0)
    eocd.writeUInt16LE(1, 10)
    eocd.writeUInt32LE(46 + name.length, 12)
    eocd.writeUInt32LE(30 + name.length + xml.length, 16)

    const docx = Buffer.concat([local, name, xml, head, name, eocd])
    expect(readDocxText(docx)).toBe('存起来的方法不一样')
  })

  test('不是 zip（比如 .doc 老格式）时报一句能照着做的错', () => {
    const doc = Buffer.from('\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1 老格式', 'binary')
    expect(() => readDocxText(doc)).toThrow(/不是 \.docx/)
  })

  test('缺 word/document.xml 时说清楚缺什么', () => {
    const docx = buildZip([{ name: 'word/styles.xml', content: '<styles/>' }])
    expect(() => readDocxText(docx)).toThrow(/没找到正文/)
  })

  test('正文是空的也报错，而不是返回空串让上游以为解析成功', () => {
    const docx = buildZip([{ name: 'word/document.xml', content: documentXml('') }])
    expect(() => readDocxText(docx)).toThrow(/没有文字内容/)
  })
})

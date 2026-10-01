import Seal from './Seal.jsx';

/**
 * 首页 = 主题展示空壳：报头 + 色板（试色）+ 字体样例 + 页脚。
 * 不接任何接口，不放业务内容；后续业务页在此主题上长出来。
 */

// 主题色板：名称 / 十六进制 / 用途（与 tokens.css 保持同步）
const SWATCHES = [
  { name: '宣纸', hex: '#F5F1E5', role: '页面底色' },
  { name: '旧宣', hex: '#EBE4D2', role: '次级面·悬停' },
  { name: '界行', hex: '#D8CFB8', role: '分隔线' },
  { name: '玄墨', hex: '#191712', role: '启动页·夜色' },
  { name: '浓墨', hex: '#211E18', role: '正文文字' },
  { name: '淡墨', hex: '#8B8371', role: '辅助文字' },
  { name: '朱砂', hex: '#B5382C', role: '印章·主操作' },
  { name: '花青', hex: '#33566B', role: '链接·进行中' },
  { name: '赭石', hex: '#8C6A3F', role: '进度·提醒' },
];

function SectionTitle({ mark, name }) {
  return (
    <div className="sec-title">
      <span className="mark">{mark}</span>
      <span className="name">{name}</span>
      <span className="rule" />
    </div>
  );
}

export default function Home() {
  return (
    <main className="page">
      <span className="watermark" aria-hidden="true">灵</span>

      {/* 报头：竖排题签 + 落印 */}
      <header className="mast enter">
        <h1 className="mast__band">墨灵</h1>
        <div className="mast__meta">
          <p className="mast__sub">自动写小说工作台</p>
          <p className="mast__tag">从选题、大纲、角色、剧情到文风，一体成书</p>
          <div style={{ marginTop: 18 }}>
            <Seal small chars={['灵']} />
          </div>
        </div>
      </header>

      {/* 色 · 试色签 */}
      <section className="sec enter d1">
        <SectionTitle mark="色" name="主题色板" />
        <div className="swatches">
          {SWATCHES.map((s) => (
            <figure
              className="swatch"
              key={s.name}
              title={`${s.name} — ${s.role}`}
            >
              <span className="swatch__chip" style={{ background: s.hex }} />
              <figcaption className="swatch__name">{s.name}</figcaption>
              <p className="swatch__hex">{s.hex}</p>
            </figure>
          ))}
        </div>
      </section>

      {/* 字 · 字体三职 */}
      <section className="sec enter d2">
        <SectionTitle mark="字" name="字体分工" />
        <div className="types">
          <span className="types__label">楷 · 题签</span>
          <p className="types__sample types__sample--display">
            墨落纸上，字从灵生
          </p>

          <span className="types__label">宋 · 书稿</span>
          <p className="types__sample types__sample--manuscript">
            他推开门时，檐下的雨正好停了。案上那方旧墨还留着昨夜未干的一笔，
            像一句没有说完的话。
          </p>

          <span className="types__label">黑 · 界面</span>
          <div className="types__sample types__sample--ui">
            <span className="is-primary">新建书稿</span>
            <span>生成大纲</span>
            <span className="is-info">笔灵正在写</span>
          </div>
        </div>
      </section>

      <footer className="foot enter d3">
        <span>墨灵 · frontend-moling · 空壳 v0.1</span>
        <span>React + Vite · 本机字体 · 无外部依赖</span>
      </footer>
    </main>
  );
}

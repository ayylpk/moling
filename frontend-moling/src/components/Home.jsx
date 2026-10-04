import { Link } from 'react-router-dom';
import Seal from './Seal.jsx';

/**
 * 首页 = 主题展示空壳：报头 + 色板（试色）+ 字体样例 + 页脚。
 * 不接任何接口，不放业务内容；后续业务页在此主题上长出来。
 */

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
          {/* v0.2 新增的唯一出口：开卷进工作台 */}
          <div className="mast__cta">
            <Link to="/w/desk" className="btn btn--primary">
              开卷 · 进工作台
            </Link>
            <span className="anno">书架 / 选题 / 大纲 / 角色 / 剧情 / 文风 / 书稿 / 设定</span>
          </div>
        </div>
      </header>

      {/* 字 · 字体三职 */}
      <section className="sec enter d1">
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

      <footer className="foot enter d2">
        <span>墨灵 · 自动写小说工作台</span>
        <span>从一条线索，到一部完整的书</span>
      </footer>
    </main>
  );
}

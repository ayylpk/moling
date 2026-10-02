import { NavLink, Outlet, Link } from 'react-router-dom';
import Seal from '../components/Seal.jsx';

/**
 * 业务工作台框架 —— DESIGN.md 第四节「待建」图的落地：
 *   侧栏 232px（宣纸底 + 右界行线，禁深色栏） + 顶栏 56px + 内容区 <Outlet/>。
 *
 * 八入口顺序 = 写书动线：书架拿书 → 选题 → 大纲 → 角色 → 剧情 → 文风 → 书稿 → 设定。
 * 激活态 = 朱砂短竖标（界尺式）+ 浓墨加粗；悬停 = 旧宣底。除竖标外侧栏不见红。
 */
const NAV = [
  { to: '/w/desk', zh: '台', name: '工作台', hint: '书目与总进度' },
  { to: '/w/topic', zh: '题', name: '选题', hint: '一句话 · 主题 · 冲突 · 结局' },
  { to: '/w/outline', zh: '纲', name: '大纲', hint: '分幕 · 张力曲线 · 硬约束' },
  { to: '/w/cast', zh: '色', name: '角色', hint: '声线 · 想要 · 代价 · 秘密' },
  { to: '/w/plot', zh: '情', name: '剧情', hint: '逐章目标 / 冲突 / 钩子' },
  { to: '/w/style', zh: '风', name: '文风', hint: '文风基准 · 禁改名单' },
  { to: '/w/manuscript', zh: '稿', name: '书稿', hint: '章目录 / 正文 / 大纲浮签' },
  { to: '/w/world', zh: '设', name: '设定', hint: '世界观 · 多版本' },
];

export default function WorkbenchLayout() {
  return (
    <div className="wb">
      {/* ---------- 侧栏 ---------- */}
      <aside className="wb__side">
        <div className="wb__brand">
          <span className="wb__band">墨灵</span>
          <Seal small chars={['灵']} />
        </div>

        <nav className="wb__nav">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              title={item.hint}
              className={({ isActive }) =>
                'wb__nav__item' + (isActive ? ' is-active' : '')
              }
            >
              <span className="wb__nav__name">{item.name}</span>
              <span className="wb__nav__zh">{item.zh}</span>
            </NavLink>
          ))}
        </nav>

        <div className="wb__side__foot">
          <Link to="/" className="wb__backlink">回到题签页</Link>
          <span className="anno">壳 v0.2 · api :3000 未接</span>
        </div>
      </aside>

      {/* ---------- 右列：顶栏 + 内容 ---------- */}
      <div className="wb__body">
        <header className="wb__top">
          <span className="wb__top__book">
            《临江》<em className="demo">示例</em>
          </span>
          <span className="wb__top__chapter">未开章</span>
          <span className="wb__top__spacer" />
          <div className="wb__top__cluster">
            {/* 三枚小示签（DESIGN 第四节）：字数 / 笔灵 / 保存。值为静态占位 */}
            <span className="pill">全稿 0 字</span>
            <span className="pill is-idle">
              <i /> 笔灵待命
            </span>
            <span className="wb__top__saved">未改动</span>
            <button type="button" className="btn btn--sm" disabled>
              落盘
            </button>
          </div>
        </header>

        <main className="wb__main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

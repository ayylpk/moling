import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, Link, useLocation } from 'react-router-dom';
import Seal from '../components/Seal.jsx';
import Conversation from '../components/Conversation.jsx';
import { api } from '../api/client.js';
import { TOPIC_OPTIONS, STYLE_OPTIONS, WORD_OPTIONS, initialPreferences } from '../lib/workbenchData.js';

/**
 * 工作台双模式壳（10/4 重塑）：
 *
 *   /w      → 执笔（Agent 工作区）：暗色链路画布占满左侧，右侧纸色对话栏，无侧栏导航
 *   /w/*    → 文库（资料视图）：左侧栏八页导航，右侧内容展示，无对话栏
 *
 * 两模式靠顶栏的 ModeSwitch（执笔/文库 翻面纸签）互切。
 * 类比 Java：这一个 Controller 两条 View 路线，Model（WorkbenchContext）两边共用。
 */

/** 文库侧栏 = 写书动线（书架收口在第一位，协作/执笔不再占导航位） */
const NAV = [
  { to: '/w/desk', zh: '架', name: '书架', hint: '小说与总进度' },
  { to: '/w/topic', zh: '题', name: '选题', hint: '主题 · 冲突 · 结局' },
  { to: '/w/world', zh: '界', name: '世界观', hint: '规则 · 势力 · 地点' },
  { to: '/w/outline', zh: '纲', name: '大纲', hint: '分卷 · 分幕 · 张力曲线' },
  { to: '/w/cast', zh: '色', name: '角色', hint: '声线 · 欲望 · 关系' },
  { to: '/w/plot', zh: '情', name: '剧情', hint: '逐章目标 · 冲突 · 钩子' },
  { to: '/w/style', zh: '风', name: '文风', hint: '文风基准 · 禁改名单' },
  { to: '/w/flavors', zh: '类', name: '题材库', hint: '类型与文风 · 素材生成' },
  { to: '/w/manuscript', zh: '稿', name: '书稿', hint: '卷章目录 · 正文编辑' },
];

const WorkbenchContext = createContext(null);
export const useWorkbench = () => useContext(WorkbenchContext);

/** 执笔 / 文库 两枚翻面纸签：当前模式 = 浓墨实底反白，另一枚淡墨描边 */
function ModeSwitch() {
  return (
    <div className="modeswitch" aria-label="界面切换">
      <NavLink to="/w" end className={({ isActive }) => `modeswitch__tab${isActive ? ' is-active' : ''}`}>执笔</NavLink>
      <NavLink to="/w/desk" className={({ isActive }) => `modeswitch__tab${isActive ? ' is-active' : ''}`}>文库</NavLink>
    </div>
  );
}

function SaveState({ saving }) {
  return (
    <span className="save-state">
      <i />
      {saving === 'saving' ? '保存中' : saving === 'dirty' ? '有修改' : '已保存'}
    </span>
  );
}

export default function WorkbenchLayout() {
  const { pathname } = useLocation();
  const isWorkspace = pathname === '/w'; // 严格等号：/w/* 全归文库

  const [topCollapsed, setTopCollapsed] = useState(true); // 规格行默认收起，顶栏只留一行
  const [chatCollapsed, setChatCollapsed] = useState(false);
  const [novels, setNovels] = useState([]);
  const [novelsLoaded, setNovelsLoaded] = useState(false);
  const [novelId, setNovelId] = useState(null);
  const [preferences, setPreferences] = useState(initialPreferences);
  const [saving, setSaving] = useState('saved');

  /**
   * 小说列表是整壳的根（顶栏选书 / 书架 / 角色 / 书稿都要它）。
   * 拉回来之前 novelId 是 null、派生出的 novel 也是 null —— 各页必须容忍这一态，
   * 不要退回一个假的 id 去请求（旧实现写死 NOVELS[0].id = 1，请求必然 404）。
   */
  useEffect(() => {
    let active = true;
    api.listNovels()
      .then((items) => {
        if (!active || !Array.isArray(items)) return;
        setNovels(items);
        setNovelId((current) => current ?? items[0]?.id ?? null);
      })
      .catch(() => undefined)
      .finally(() => { if (active) setNovelsLoaded(true); });
    return () => { active = false; };
  }, []);

  const novel = novels.find((item) => item.id === novelId) || novels[0] || null;
  const value = useMemo(
    () => ({ novel, novels, novelsLoaded, setNovelId, setNovels, preferences, setPreferences, saving, setSaving }),
    [novel, novels, novelsLoaded, preferences, saving],
  );

  const toggleTopic = (topic) =>
    setPreferences((current) => ({
      ...current,
      topics: current.topics.includes(topic)
        ? current.topics.filter((item) => item !== topic)
        : [...current.topics, topic],
    }));
  const addCustom = (key, label) => {
    const input = window.prompt(`添加${label}`)?.trim();
    if (input) setPreferences((current) => ({ ...current, [key]: key === 'topics' ? [...current.topics, input] : input }));
  };

  /* ---------- 模式一 · 执笔：暗色画布 + 纸色对话栏 ---------- */
  if (isWorkspace) {
    return (
      <WorkbenchContext.Provider value={value}>
        <div className={`ws${chatCollapsed ? ' ws--chat-collapsed' : ''}`}>
          <header className="ws__bar">
            <Link to="/" className="ws__brand" title="回到题签页">
              <span className="ws__brand-seal">灵</span>
              <span className="ws__brand-name">墨灵</span>
            </Link>
            <ModeSwitch />
            <span className="ws__bar-book">{novel ? `《${novel.title}》· ${novel.genre || '未定题材'}` : '还没有书稿'}</span>
            <span className="ws__bar__spacer" />
            <SaveState saving={saving} />
          </header>
          <main className="ws__stage">
            <Outlet />
          </main>
          <Conversation collapsed={chatCollapsed} onToggle={() => setChatCollapsed(!chatCollapsed)} />
        </div>
      </WorkbenchContext.Provider>
    );
  }

  /* ---------- 模式二 · 文库：侧栏导航 + 内容展示 ---------- */
  return (
    <WorkbenchContext.Provider value={value}>
      <div className="wb">
        <aside className="wb__side">
          <div className="wb__brand">
            <Link to="/" className="wb__brand-link" title="回到题签页">
              <span className="wb__band">墨灵</span>
              <span className="wb__brand-name">文库</span>
            </Link>
            <Seal small chars={['灵']} />
          </div>
          <nav className="wb__nav">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                title={item.hint}
                className={({ isActive }) => `wb__nav__item${isActive ? ' is-active' : ''}`}
              >
                <span className="wb__nav__name">{item.name}</span>
                <span className="wb__nav__zh">{item.zh}</span>
              </NavLink>
            ))}
          </nav>
          <div className="wb__side__foot">
            <Link to="/" className="wb__backlink">回到题签页</Link>
          </div>
        </aside>
        <div className="wb__body">
          <header className="wb__topbar">
            <div className="wb__topbar-head">
              <ModeSwitch />
              <label className="wb__novel-select">
                <span className="wb__top-label">当前小说</span>
                <select
                  value={novelId ?? ''}
                  disabled={novels.length === 0}
                  onChange={(event) => setNovelId(Number(event.target.value))}
                >
                  {novels.length === 0 && <option value="">{novelsLoaded ? '还没有书稿' : '读取中…'}</option>}
                  {novels.map((item) => (
                    <option value={item.id} key={item.id}>《{item.title}》</option>
                  ))}
                </select>
              </label>
              <span className="wb__top__spacer" />
              <SaveState saving={saving} />
              <button className="wb__top-toggle" type="button" onClick={() => setTopCollapsed(!topCollapsed)}>
                {topCollapsed ? '展开规格' : '收起规格'}
              </button>
            </div>
            {!topCollapsed && (
              <div className="spec-rows">
                <SpecPicker label="主题" values={TOPIC_OPTIONS} selected={preferences.topics} onToggle={toggleTopic} onCustom={() => addCustom('topics', '主题')} />
                <SpecPicker label="文风" values={STYLE_OPTIONS} selected={[preferences.style]} onToggle={(style) => setPreferences((current) => ({ ...current, style }))} onCustom={() => addCustom('style', '文风')} />
                <SpecPicker label="字数" values={WORD_OPTIONS} selected={[preferences.wordCount]} onToggle={(wordCount) => setPreferences((current) => ({ ...current, wordCount }))} onCustom={() => addCustom('wordCount', '字数')} />
              </div>
            )}
          </header>
          <main className="wb__main">
            <Outlet />
          </main>
        </div>
      </div>
    </WorkbenchContext.Provider>
  );
}

function SpecPicker({ label, values, selected, onToggle, onCustom }) {
  return (
    <div className="spec-picker">
      <span className="spec-picker__label">{label}</span>
      <div className="spec-picker__options">
        {values.map((value) => (
          <button type="button" className={selected.includes(value) ? 'is-selected' : ''} onClick={() => onToggle(value)} key={value}>
            {value}
          </button>
        ))}
        {onCustom && (
          <button type="button" className="is-custom" onClick={onCustom}>
            自定义
          </button>
        )}
      </div>
    </div>
  );
}

import { createContext, useContext, useMemo, useState } from 'react';
import { NavLink, Outlet, Link, useNavigate } from 'react-router-dom';
import Seal from '../components/Seal.jsx';
import { NOVELS, TOPIC_OPTIONS, STYLE_OPTIONS, WORD_OPTIONS, initialPreferences } from '../lib/workbenchData.js';

const NAV = [
  { to: '/w/collaboration', zh: '灵', name: '协作总览', hint: '中心 Agent 与任务依赖' },
  { to: '/w/topic', zh: '题', name: '选题', hint: '主题 · 冲突 · 结局' },
  { to: '/w/world', zh: '界', name: '世界观', hint: '规则 · 势力 · 地点' },
  { to: '/w/outline', zh: '纲', name: '大纲', hint: '分卷 · 分幕 · 张力曲线' },
  { to: '/w/cast', zh: '色', name: '角色', hint: '声线 · 欲望 · 关系' },
  { to: '/w/plot', zh: '情', name: '剧情', hint: '逐章目标 · 冲突 · 钩子' },
  { to: '/w/style', zh: '风', name: '文风', hint: '文风基准 · 禁改名单' },
  { to: '/w/manuscript', zh: '稿', name: '书稿', hint: '卷章目录 · 正文编辑' },
  { to: '/w/desk', zh: '架', name: '书架', hint: '小说与总进度' },
];

const WorkbenchContext = createContext(null);
export const useWorkbench = () => useContext(WorkbenchContext);

export default function WorkbenchLayout() {
  const [sideCollapsed, setSideCollapsed] = useState(false);
  const [topCollapsed, setTopCollapsed] = useState(false);
  const [chatCollapsed, setChatCollapsed] = useState(false);
  const [novelId, setNovelId] = useState(NOVELS[0].id);
  const [preferences, setPreferences] = useState(initialPreferences);
  const [saving, setSaving] = useState('saved');
  const navigate = useNavigate();
  const novel = NOVELS.find((item) => item.id === novelId) || NOVELS[0];
  const value = useMemo(() => ({ novel, preferences, setPreferences, saving, setSaving }), [novel, preferences, saving]);

  const toggleTopic = (topic) => setPreferences((current) => ({ ...current, topics: current.topics.includes(topic) ? current.topics.filter((item) => item !== topic) : [...current.topics, topic] }));
  const addCustom = (key, label) => {
    const value = window.prompt(`添加${label}`)?.trim();
    if (value) setPreferences((current) => ({ ...current, [key]: key === 'topics' ? [...current.topics, value] : value }));
  };

  return (
    <WorkbenchContext.Provider value={value}>
      <div className={`wb${sideCollapsed ? ' is-side-collapsed' : ''}${topCollapsed ? ' is-top-collapsed' : ''}${chatCollapsed ? ' is-chat-collapsed' : ''}`}>
        <aside className="wb__side">
          <div className="wb__brand"><Link to="/w/collaboration" className="wb__brand-link"><span className="wb__band">墨灵</span><span className="wb__brand-name">小说工作台</span></Link><Seal small chars={['灵']} /></div>
          <nav className="wb__nav">{NAV.map((item) => <NavLink key={item.to} to={item.to} title={item.hint} className={({ isActive }) => `wb__nav__item${isActive ? ' is-active' : ''}`}><span className="wb__nav__name">{item.name}</span><span className="wb__nav__zh">{item.zh}</span></NavLink>)}</nav>
          <div className="wb__side__foot"><button className="wb__collapse" type="button" onClick={() => setSideCollapsed(true)} aria-label="收起左侧栏">收起侧栏</button><Link to="/" className="wb__backlink">回到题签页</Link><span className="anno">小说独立存储 · 工作中</span></div>
        </aside>
        <div className="wb__body">
          <header className="wb__top">
            <button className="wb__expand" type="button" onClick={() => setSideCollapsed(false)} aria-label="展开左侧栏">墨</button>
            <label className="wb__novel-select"><span className="wb__top-label">当前小说</span><select value={novelId} onChange={(event) => setNovelId(Number(event.target.value))}>{NOVELS.map((item) => <option value={item.id} key={item.id}>《{item.title}》</option>)}</select></label>
            {!topCollapsed && <><div className="wb__top-divider" /><SpecPicker label="主题" values={TOPIC_OPTIONS} selected={preferences.topics} onToggle={toggleTopic} onCustom={() => addCustom('topics', '主题')} /><SpecPicker label="文风" values={STYLE_OPTIONS} selected={[preferences.style]} onToggle={(style) => setPreferences((current) => ({ ...current, style }))} onCustom={() => addCustom('style', '文风')} /><SpecPicker label="字数" values={WORD_OPTIONS} selected={[preferences.wordCount]} onToggle={(wordCount) => setPreferences((current) => ({ ...current, wordCount }))} /></>}
            <span className="wb__top__spacer" /><span className="save-state"><i />{saving === 'saving' ? '保存中' : saving === 'dirty' ? '有修改' : '已保存'}</span><button className="wb__top-toggle" type="button" onClick={() => setTopCollapsed(!topCollapsed)} aria-label={topCollapsed ? '展开顶栏设置' : '收起顶栏设置'}>{topCollapsed ? '展开规格' : '收起规格'}</button>
          </header>
          <aside className="wb__chat-rail"><div className="chat-rail__heading"><span className="chat-rail__seal">灵</span><span>中心 Agent</span></div><div className="chat-rail__message"><span className="anno">刚刚</span><p>第 2 章的情绪曲线需要你确认。</p></div><div className="chat-rail__ask"><span className="status is-paused">ask-human · 1</span><p>选择林晚在坡道下的回应。</p><button className="btn btn--sm" type="button" onClick={() => navigate('/w/plot')}>去处理</button></div><div className="chat-rail__input"><span>向中心 Agent 说点什么…</span><button type="button" aria-label="发送">↗</button></div><button className="chat-rail__collapse" type="button" onClick={() => setChatCollapsed(!chatCollapsed)} aria-label={chatCollapsed ? '展开 Agent 对话栏' : '收起 Agent 对话栏'}>{chatCollapsed ? '›' : '‹'}</button></aside>
          <main className="wb__main"><Outlet /></main>
        </div>
      </div>
    </WorkbenchContext.Provider>
  );
}

function SpecPicker({ label, values, selected, onToggle, onCustom }) {
  return <div className="spec-picker"><span className="spec-picker__label">{label}</span><div className="spec-picker__options">{values.slice(0, 3).map((value) => <button type="button" className={selected.includes(value) ? 'is-selected' : ''} onClick={() => onToggle(value)} key={value}>{value}</button>)}{onCustom && <button type="button" className="is-custom" onClick={onCustom}>自定义</button>}</div></div>;
}

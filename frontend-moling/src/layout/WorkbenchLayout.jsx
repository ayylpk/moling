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
          <header className={`wb__topbar${topCollapsed ? ' is-collapsed' : ''}`}>
            <div className="wb__topbar-head"><button className="wb__expand" type="button" onClick={() => setSideCollapsed(false)} aria-label="展开左侧栏">展开导航</button><label className="wb__novel-select"><span className="wb__top-label">当前小说</span><select value={novelId} onChange={(event) => setNovelId(Number(event.target.value))}>{NOVELS.map((item) => <option value={item.id} key={item.id}>《{item.title}》</option>)}</select></label><span className="wb__topbar-caption">自动写作工作台</span><span className="wb__top__spacer" /><span className="save-state"><i />{saving === 'saving' ? '保存中' : saving === 'dirty' ? '有修改' : '已保存'}</span><button className="wb__top-toggle" type="button" onClick={() => setTopCollapsed(!topCollapsed)}>{topCollapsed ? '展开规格' : '收起规格'}</button></div>
            {!topCollapsed && <div className="spec-rows"><SpecPicker label="主题" values={TOPIC_OPTIONS} selected={preferences.topics} onToggle={toggleTopic} onCustom={() => addCustom('topics', '主题')} /><SpecPicker label="文风" values={STYLE_OPTIONS} selected={[preferences.style]} onToggle={(style) => setPreferences((current) => ({ ...current, style }))} onCustom={() => addCustom('style', '文风')} /><SpecPicker label="字数" values={WORD_OPTIONS} selected={[preferences.wordCount]} onToggle={(wordCount) => setPreferences((current) => ({ ...current, wordCount }))} onCustom={() => addCustom('wordCount', '字数')} /></div>}
          </header>
          <aside className={`wb__conversation${chatCollapsed ? ' is-collapsed' : ''}`}><div className="conversation__head"><div><span className="conversation__eyebrow">协作频道</span><h2><span className="chat-rail__seal">灵</span>中心 Agent</h2></div><button type="button" className="conversation__collapse" onClick={() => setChatCollapsed(!chatCollapsed)}>{chatCollapsed ? '展开对话' : '收起对话'}</button></div>{!chatCollapsed && <><div className="conversation__context"><span className="status is-writing">正在协调</span><strong>第 2 章 · 情绪曲线</strong><span className="anno">连接 7 个工作节点</span></div><div className="conversation__messages"><div className="conversation__message is-agent"><span className="conversation__message-label">中心 Agent · 刚刚</span><p>角色弧线已经接上了。第 2 章的情绪曲线需要你确认，我会根据选择继续安排写作。</p></div><div className="conversation__message is-system"><span className="conversation__message-label">系统记录</span><p>角色 Agent 已完成 2 / 4 张卡片，写作 Agent 等待输入。</p></div><div className="conversation__message is-user"><span className="conversation__message-label">你 · 10:42</span><p>先保留林晚的沉默。</p></div></div><div className="conversation__ask"><div className="conversation__ask-head"><span className="status is-paused">需要你的决定</span><span className="anno">ask-human · 1</span></div><h3>林晚在坡道下如何回应？</h3><p>这个选择会影响第 2 章的冲突强度和角色关系。</p><div className="conversation__choices"><button type="button" onClick={() => navigate('/w/plot')}>A　继续沉默</button><button type="button" onClick={() => navigate('/w/plot')}>B　主动提问</button></div></div><div className="conversation__composer"><textarea placeholder="告诉中心 Agent 下一步怎么做…" /><button type="button" className="btn btn--primary">发送指令</button></div></>}</aside>
          <main className="wb__main"><Outlet /></main>
        </div>
      </div>
    </WorkbenchContext.Provider>
  );
}

function SpecPicker({ label, values, selected, onToggle, onCustom }) {
  return <div className="spec-picker"><span className="spec-picker__label">{label}</span><div className="spec-picker__options">{values.map((value) => <button type="button" className={selected.includes(value) ? 'is-selected' : ''} onClick={() => onToggle(value)} key={value}>{value}</button>)}{onCustom && <button type="button" className="is-custom" onClick={onCustom}>自定义</button>}</div></div>;
}

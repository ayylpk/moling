import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Outlet, Link, useLocation } from 'react-router-dom';
import Seal from '../components/Seal.jsx';
import AskModal from '../components/AskModal.jsx';
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
  // 「文风基准」是这本书的，「题材文风」是全站共享的片段库 —— 两个名字必须分得开，
  // 原先叫「文风」和「题材库」，看不出哪个才是"选题材文风"的地方
  { to: '/w/style', zh: '风', name: '文风基准', hint: '本书口吻 · 禁语 · 专名' },
  { to: '/w/flavors', zh: '类', name: '题材文风', hint: '全局片段库 · 素材生成' },
  { to: '/w/manuscript', zh: '稿', name: '书稿', hint: '卷章目录 · 正文编辑' },
];

const WorkbenchContext = createContext(null);
export const useWorkbench = () => useContext(WorkbenchContext);

/* ==================== 可拖拽的侧栏宽度 ==================== */

const NAV_WIDTH_KEY = 'moling:ui:navWidth';
const CHAT_WIDTH_KEY = 'moling:ui:chatWidth';
/** 文库左侧栏：再窄放不下「文风基准」四个字，再宽只是浪费正文的地方 */
const NAV_WIDTH = { initial: 232, min: 176, max: 340 };
/** 执笔右侧对话栏：窄了读不了长回复（中心 Agent 的话常常一大段），宽了画布就没地方 */
const CHAT_WIDTH = { initial: 380, min: 300, max: 720 };

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

/**
 * 拖侧栏的边，改栅格列宽。
 *
 * `side` 指的是面板在**哪一侧**：在左边就"往右拖变宽"，在右边就反过来。
 * 少了这个参数，右侧那栏拖起来会反着走 —— 这种反直觉比不能拖更烦人。
 *
 * ── 为什么存 localStorage、且键里不带 novelId ──
 * 这是**界面偏好**，不是小说数据：同一台机器上换个作者、换本书，他习惯的栏宽是一样的。
 * （对比书稿页的草稿缓存 `moling:<novelId>:chapter:<id>:draft` —— 那个必须按书分，
 * 因为 chapterId 每本都从 1 重开。）
 */
function useDragWidth({ storageKey, side, initial, min, max }) {
  const [width, setWidth] = useState(() => {
    const raw = Number(window.localStorage.getItem(storageKey));
    return Number.isFinite(raw) && raw > 0 ? clamp(raw, min, max) : initial;
  });
  /** 拖拽中的现场。非空即"正在拖"——存盘要靠它判断，见下面那个 effect */
  const drag = useRef(null);
  /** 每次渲染同步一次，`pointerup` 里要拿最新值写盘（那个回调闭包里的 width 是旧的） */
  const latest = useRef(width);
  latest.current = width;

  const onPointerDown = (event) => {
    event.preventDefault();
    drag.current = { startX: event.clientX, startWidth: width };
    const onMove = (moveEvent) => {
      const delta = side === 'left' ? moveEvent.clientX - drag.current.startX : drag.current.startX - moveEvent.clientX;
      setWidth(clamp(drag.current.startWidth + delta, min, max));
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      // 拖拽期间整页禁选中、光标保持 col-resize —— 否则手一快就划出一片蓝色选区
      document.body.classList.remove('is-resizing');
      window.localStorage.setItem(storageKey, String(Math.round(latest.current)));
      drag.current = null;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    document.body.classList.add('is-resizing');
  };

  /** 键盘也能调（Tab 到那条缝上，左右方向键；按 Shift 一次走 24px） */
  const onKeyDown = (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    const step = (event.shiftKey ? 24 : 8) * (event.key === 'ArrowRight' ? 1 : -1);
    setWidth((current) => clamp(current + (side === 'left' ? step : -step), min, max));
    event.preventDefault();
  };

  /*
   * 拖拽中**不写盘**：pointermove 每帧都来一次，而 localStorage 是同步写，会卡。
   * 收尾在 pointerup 里做一次。键盘调整走这里（次数少，无所谓）。
   */
  useEffect(() => {
    if (drag.current) return;
    window.localStorage.setItem(storageKey, String(Math.round(width)));
  }, [storageKey, width]);

  return { width, handleProps: { onPointerDown, onKeyDown, role: 'separator', 'aria-orientation': 'vertical', tabIndex: 0 } };
}

/** 那条能拖的缝。样式在 global.css（两个模式共用） */
function ResizeHandle({ label, style, ...props }) {
  return <span className="resize-handle" style={style} title="拖动调整宽度（方向键也可以）" aria-label={label} {...props} />;
}

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
  /**
   * 对话记录放在**这一层**而不是 Conversation 组件里。
   *
   * Conversation 只在执笔模式挂载：作者一回文库看卷章，它就卸载，聊天记录全没 ——
   * 而 WorkbenchLayout 在所有路由下都活着。所以"聊到哪了"归它管，组件只管显示。
   * （这只解决"切页面丢"；**刷新仍会丢** —— 那得给网页这条 chat 路径挂 checkpointer，
   * 现在只有开发 CLI 那条有。）
   */
  const [chatMessages, setChatMessages] = useState([]);
  /** 对话栏放大成覆盖窗（读长回复用）。也是布局状态，所以同样放这层 */
  const [chatMax, setChatMax] = useState(false);
  /** 两条能拖的栏宽（都是界面偏好，存 localStorage，不按书分） */
  const nav = useDragWidth({ storageKey: NAV_WIDTH_KEY, side: 'left', ...NAV_WIDTH });
  const chat = useDragWidth({ storageKey: CHAT_WIDTH_KEY, side: 'right', ...CHAT_WIDTH });
  const [novels, setNovels] = useState([]);
  const [novelsLoaded, setNovelsLoaded] = useState(false);
  const [novelId, setNovelId] = useState(null);
  const [preferences, setPreferences] = useState(initialPreferences);
  const [saving, setSaving] = useState('saved');
  /** 规格行"自定义"正在问的东西：{ key, label, value }，null = 没在问 */
  const [customAsk, setCustomAsk] = useState(null);

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
    () => ({ novel, novels, novelsLoaded, setNovelId, setNovels, preferences, setPreferences, saving, setSaving, chatMessages, setChatMessages, chatMax, setChatMax }),
    [novel, novels, novelsLoaded, preferences, saving, chatMessages, chatMax],
  );

  const toggleTopic = (topic) =>
    setPreferences((current) => ({
      ...current,
      topics: current.topics.includes(topic)
        ? current.topics.filter((item) => item !== topic)
        : [...current.topics, topic],
    }));
  /**
   * 规格行的"自定义"：先摆输入框，确认了再写进偏好。
   *
   * 与删除/改名同一个理由不用 `window.prompt` —— 原生对话框在嵌入式预览与
   * 各家 WebView 里会被静默吞掉，点了等于没点。见 `components/AskModal.jsx`。
   */
  const confirmCustom = () => {
    const input = (customAsk?.value ?? '').trim();
    if (!input) { setCustomAsk(null); return; }
    setPreferences((current) => ({ ...current, [customAsk.key]: customAsk.key === 'topics' ? [...current.topics, input] : input }));
    setCustomAsk(null);
  };

  /* ---------- 模式一 · 执笔：暗色画布 + 纸色对话栏 ---------- */
  if (isWorkspace) {
    return (
      <WorkbenchContext.Provider value={value}>
        <div
          className={`ws${chatCollapsed ? ' ws--chat-collapsed' : ''}`}
          // 收起时不写这条：`.ws--chat-collapsed` 那条 48px 会被行内样式压掉
          style={chatCollapsed ? undefined : { gridTemplateColumns: `minmax(0, 1fr) ${chat.width}px` }}
        >          <header className="ws__bar">
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
          {/* 放大时拖拽条没意义（宽度由覆盖窗自己定），不渲染 */}
          {!chatCollapsed && !chatMax && <ResizeHandle label="调整对话栏宽度" style={{ left: -4 }} {...chat.handleProps} />}
          <Conversation collapsed={chatCollapsed} maximized={chatMax} onToggleMax={() => setChatMax((value) => !value)} onToggle={() => setChatCollapsed(!chatCollapsed)} />
        </div>
      </WorkbenchContext.Provider>
    );
  }

  /* ---------- 模式二 · 文库：侧栏导航 + 内容展示 ---------- */
  return (
    <WorkbenchContext.Provider value={value}>
      <div className="wb" style={{ gridTemplateColumns: `${nav.width}px minmax(0, 1fr)` }}>
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
          {/* 拖拽条压在侧栏右缘的界行线上：往右拖把侧栏拉宽，往左拖收窄 */}
          <ResizeHandle label="调整侧栏宽度" style={{ right: -5 }} {...nav.handleProps} />
        </aside>
        <div className="wb__body">
          <header className="wb__topbar">
            <div className="wb__topbar-head">
              <ModeSwitch />
              <NovelSwitcher novels={novels} novelsLoaded={novelsLoaded} novelId={novelId} onChange={setNovelId} />
              <span className="wb__top__spacer" />
              <SaveState saving={saving} />
              <button className="wb__top-toggle" type="button" onClick={() => setTopCollapsed(!topCollapsed)}>
                {topCollapsed ? '展开规格' : '收起规格'}
              </button>
            </div>
            {!topCollapsed && (
              <div className="spec-rows">
                <SpecPicker label="主题" values={TOPIC_OPTIONS} selected={preferences.topics} onToggle={toggleTopic} onCustom={() => setCustomAsk({ key: 'topics', label: '主题', value: '' })} />
                <SpecPicker label="文风" values={STYLE_OPTIONS} selected={[preferences.style]} onToggle={(style) => setPreferences((current) => ({ ...current, style }))} onCustom={() => setCustomAsk({ key: 'style', label: '文风', value: '' })} />
                <SpecPicker label="字数" values={WORD_OPTIONS} selected={[preferences.wordCount]} onToggle={(wordCount) => setPreferences((current) => ({ ...current, wordCount }))} onCustom={() => setCustomAsk({ key: 'wordCount', label: '字数', value: '' })} />
              </div>
            )}
          </header>
          <main className="wb__main">
            <Outlet />
          </main>
        </div>
      </div>

      {/* 放在 .wb 外面：.wb 是两列 grid，多一个直接子元素会多出一条轨道 */}
      {customAsk && (
        <AskModal
          eyebrow="CUSTOM"
          title={`自定义${customAsk.label}`}
          note="写在规格行上的偏好，只影响这一处界面；题眼与片段仍以书和题材文风库里的为准。"
          input={{
            label: customAsk.label,
            value: customAsk.value,
            placeholder: `例如：${customAsk.key === 'wordCount' ? '45 万' : customAsk.key === 'style' ? '清冷的' : '宿命'}`,
            onChange: (next) => setCustomAsk((current) => ({ ...current, value: next })),
          }}
          confirmLabel="加上"
          onCancel={() => setCustomAsk(null)}
          onConfirm={confirmCustom}
        />
      )}
    </WorkbenchContext.Provider>
  );
}

/**
 * 当前小说切换器。
 *
 * **为什么不用原生 `<select>`**：它在纸色界面上是一块系统灰，和其它零件不是一路；
 * 而且它只能显示一行文字 —— 一本书有题材和文风，切换时正该看见，否则"切过去了没有"
 * 要等进了书稿页才知道。这里自绘：名字用display字体（与原来同一处视觉重量），
 * 展开后每项带题材·文风。
 */
function NovelSwitcher({ novels, novelsLoaded, novelId, onChange }) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);
  const current = novels.find((item) => item.id === novelId) || null;

  /* 展开后才挂全局监听：点空白处、按 Esc 都收起来（不然要再点一次按钮） */
  useEffect(() => {
    if (!open) return undefined;
    const onDocMouseDown = (event) => { if (!boxRef.current?.contains(event.target)) setOpen(false); };
    const onKeyDown = (event) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const empty = novels.length === 0;
  return (
    <div className="wb__novel-select novel-switch" ref={boxRef}>
      <span className="wb__top-label">当前小说</span>
      <button
        type="button"
        className={`novel-switch__trigger${open ? ' is-open' : ''}`}
        disabled={empty}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="novel-switch__title">
          {current ? `《${current.title}》` : novelsLoaded ? '还没有书稿' : '读取中…'}
        </span>
        {current?.genre && <span className="novel-switch__genre">{current.genre}</span>}
        <span className="novel-switch__caret" aria-hidden="true">▾</span>
      </button>
      {open && (
        <ul className="novel-switch__list" role="listbox" aria-label="当前小说">
          {novels.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                role="option"
                aria-selected={item.id === novelId}
                className={item.id === novelId ? 'is-active' : ''}
                onClick={() => { onChange(item.id); setOpen(false); }}
              >
                <span className="novel-switch__opt-title">《{item.title}》</span>
                <span className="novel-switch__opt-meta">{item.genre || item.style ? [item.genre, item.style].filter(Boolean).join(' · ') : '未定题材与文风'}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
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

import { useEffect, useRef, useState } from 'react';
import { useWorkbench } from '../layout/WorkbenchLayout.jsx';
import { api } from '../api/client.js';

/**
 * 执笔 · 夜案画布。
 * 案心一盏「灵」（中心 Agent，突出显示），四周六盏按**阶段**摆成一案：
 *   上排 = 上游约束（世界观 / 大纲）  左 = 角色 / 场景
 *   右   = 章节任务                   下 = 润色
 *
 * **数据全部来自 `GET /api/novels/:id/workflow`** 的聚合结果：
 * 每个阶段回了 total/done/running/failed/pending，脸色由这四个数推出来
 * （在跑 → running；有折的 → failed；该阶段全成 → done；其余 → idle）。
 * 案心显示的是 `phase` 对应的人话（例如「正在整理大纲」）与全案合计。
 *
 * 页面**不摆任何静态状态**：读不到就说读不到，没有数据源的字段（例如"更新时间"）
 * 干脆不画 —— 摆一个假数比空着更糟。
 * 也不给用户任何**任务队列**的操作入口：任务表是 generate_chapter 的内部实现。
 *
 * 每 5 秒重取一次：Agent 是在后台干活，界面得跟着动。
 */

const STATE_LABEL = { done: '已成', running: '在写', idle: '待命', failed: '折笔' };

/** 六个阶段（与后台 byStage 的键一一对应）。名字与楷记是画布上的固定写法 */
const STAGES = [
  { id: 'world', name: '设定', mark: '界' },
  { id: 'character', name: '角色', mark: '色' },
  { id: 'location', name: '场景', mark: '景' },
  { id: 'outline', name: '大纲', mark: '纲' },
  { id: 'chapter', name: '章节', mark: '章' },
  { id: 'polish', name: '润色', mark: '润' },
];

// 灯位方位写死；按 id 取节点，不怕后端调整顺序
const RING = {
  top: ['world', 'outline'],
  left: ['character', 'location'],
  right: ['chapter'],
  bottom: ['polish'],
};

const BUBBLE_HALF = 152; // 浮签半宽，用来夹左右边距
const POLL_MS = 5000;

/** 一组计数 → 一盏灯的脸色。与后台 workflowStatus 的判据一致：在跑优先于折笔，折笔优先于全成 */
const stateOfCounts = (counts) => {
  if (!counts) return 'idle';
  if (counts.running > 0) return 'running';
  if (counts.failed > 0) return 'failed';
  if (counts.total > 0 && counts.done >= counts.total) return 'done';
  return 'idle';
};

const summaryOfCounts = (counts) => {
  if (!counts || counts.total === 0) return '还没登记任务';
  const parts = [`${counts.done}/${counts.total} 已成`];
  if (counts.running > 0) parts.push(`${counts.running} 在写`);
  if (counts.pending > 0) parts.push(`${counts.pending} 待跑`);
  if (counts.failed > 0) parts.push(`${counts.failed} 折笔`);
  return parts.join(' · ');
};

export default function Workspace() {
  const { novel } = useWorkbench();
  const mapRef = useRef(null);
  const [summary, setSummary] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [bubble, setBubble] = useState(null);

  useEffect(() => {
    if (!novel?.id) {
      setSummary(null);
      setLoaded(true);
      setError('');
      return undefined;
    }
    let active = true;
    const load = () => {
      api.workflow(novel.id)
        .then((result) => { if (active && result) { setSummary(result); setError(''); } })
        .catch((cause) => { if (active) setError(cause.message || '读不到工作流状态'); })
        .finally(() => { if (active) setLoaded(true); });
    };
    setLoaded(false);
    load();
    const timer = window.setInterval(load, POLL_MS);
    return () => { active = false; window.clearInterval(timer); };
  }, [novel?.id]);

  const byStage = summary?.byStage ?? {};
  const lamps = Object.fromEntries(
    STAGES.map((stage) => [
      stage.id,
      { ...stage, state: stateOfCounts(byStage[stage.id]), summary: summaryOfCounts(byStage[stage.id]) },
    ]),
  );

  const hub = summary
    ? {
        id: 'hub',
        name: '中心 Agent',
        mark: '灵',
        state: stateOfCounts({ total: summary.total, done: summary.done, running: summary.running, failed: summary.failed, pending: 0 }),
        current: summary.label || '',
        summary: summary.total === 0 ? '还没有可跑的任务' : `全案 ${summary.done}/${summary.total} 已成`,
      }
    : null;

  /** 浮签落点：以节点底边中点为准；过案面 62% 高度就翻到头顶，左右夹到画布边内 */
  const showBubble = (event, info) => {
    const map = mapRef.current;
    if (!map) return;
    const s = map.getBoundingClientRect();
    const r = event.currentTarget.getBoundingClientRect();
    const x = Math.min(Math.max(r.left + r.width / 2 - s.left, BUBBLE_HALF + 12), s.width - BUBBLE_HALF - 12);
    const above = r.bottom - s.top > s.height * 0.62;
    const y = above ? r.top - s.top - 12 : r.bottom - s.top + 12;
    setBubble({ info, x, y, above });
  };
  const hideBubble = () => setBubble(null);
  const bind = (info) => ({
    onMouseEnter: (e) => showBubble(e, info),
    onMouseLeave: hideBubble,
    onFocus: (e) => showBubble(e, info),
    onBlur: hideBubble,
  });

  if (!novel) {
    return (
      <div className="wsc">
        <span className="wsc__watermark" aria-hidden="true">灵</span>
        <p className="wsc__caption">{loaded ? '先到书架建一本小说，案上才有灯。' : '正在读取书架……'}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="wsc">
        <span className="wsc__watermark" aria-hidden="true">灵</span>
        <p className="wsc__caption">读不到工作流状态：{error}</p>
      </div>
    );
  }

  if (!summary || !hub) {
    return (
      <div className="wsc">
        <span className="wsc__watermark" aria-hidden="true">灵</span>
        <p className="wsc__caption">正在读取工作流状态……</p>
      </div>
    );
  }

  return (
    <div className="wsc">
      <span className="wsc__watermark" aria-hidden="true">灵</span>
      <p className="wsc__caption">案上六盏灯围着中心 Agent —— 悬灯即见近况，灯下留白是它闲着</p>

      <section className="wsc__map" ref={mapRef} aria-label="Agent 协作链路">
        <div className="wsc__lines" aria-hidden="true">
          <span className="wsc__line wsc__line--v wsc__line--top" />
          <span className="wsc__line wsc__line--v wsc__line--bottom" />
          <span className="wsc__line wsc__line--h wsc__line--left" />
          <span className="wsc__line wsc__line--h wsc__line--right" />
        </div>

        <div className="wsc__orbit wsc__orbit--top">
          {RING.top.map((id) => <Lamp key={id} agent={lamps[id]} bind={bind} />)}
        </div>
        <div className="wsc__orbit wsc__orbit--side wsc__orbit--left">
          {RING.left.map((id) => <Lamp key={id} agent={lamps[id]} bind={bind} />)}
        </div>

        <button type="button" className={`wsc__hub is-${hub.state}`} {...bind(hub)}>
          <span className="wsc__hub-seal">灵</span>
          <span className="wsc__hub-name">中心 Agent</span>
          <span className="wsc__hub-state"><i />{STATE_LABEL[hub.state]}</span>
        </button>

        <div className="wsc__orbit wsc__orbit--side wsc__orbit--right">
          {RING.right.map((id) => <Lamp key={id} agent={lamps[id]} bind={bind} />)}
        </div>
        <div className="wsc__orbit wsc__orbit--bottom">
          {RING.bottom.map((id) => <Lamp key={id} agent={lamps[id]} bind={bind} />)}
        </div>

        {bubble && <Bubble info={bubble.info} x={bubble.x} y={bubble.y} above={bubble.above} />}
      </section>

      <footer className="wsc__legend">
        <span className="wsc__legend__item is-running"><i />在写 · 亮</span>
        <span className="wsc__legend__item is-done"><i />已成 · 常</span>
        <span className="wsc__legend__item is-idle"><i />待命 · 暗</span>
        <span className="wsc__legend__item is-failed"><i />折笔 · 沉</span>
      </footer>
    </div>
  );
}

/** 一盏灯：楷记 + 名 + 状态点，脸色由 is-{state} 决定 */
function Lamp({ agent, bind }) {
  if (!agent) return null;
  return (
    <button type="button" className={`wsc__lamp is-${agent.state}`} {...bind(agent)}>
      <span className="wsc__lamp-mark">{agent.mark}</span>
      <span className="wsc__lamp-name">{agent.name}</span>
      <span className="wsc__lamp-state"><i />{STATE_LABEL[agent.state]}</span>
    </button>
  );
}

/**
 * 浮签：当前在做什么 / 统计。
 * 版式里原本还有"本轮 token"和"更新时间"两行 —— 当前接口都没有这两个数据源，
 * 已去掉，不摆假数。
 */
function Bubble({ info, x, y, above }) {
  return (
    <div
      className={`wsc__bubble is-${info.state}`}
      style={{ left: x, top: y, transform: above ? 'translate(-50%, -100%)' : 'translate(-50%, 0)' }}
      role="tooltip"
    >
      <div className="wsc__bubble-head">
        <span className="wsc__bubble-mark">{info.mark}</span>
        <strong className="wsc__bubble-name">{info.name}</strong>
        <span className="wsc__bubble-state">{STATE_LABEL[info.state]}</span>
      </div>
      {info.current && <p className="wsc__bubble-row"><span>当前</span>{info.current}</p>}
      <p className="wsc__bubble-row"><span>统计</span>{info.summary}</p>
    </div>
  );
}

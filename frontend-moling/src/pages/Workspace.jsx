import { useEffect, useRef, useState } from 'react';
import { useWorkbench } from '../layout/WorkbenchLayout.jsx';
import { api } from '../api/client.js';

/**
 * 执笔 · 夜案画布。
 * 案心一盏「灵」，四周五盏手 + 一章务，环着摆成一案：
 *   上排 = 上游约束（世界观 / 大纲）  左 = 角色 / 场景
 *   右   = 章节任务 / 执笔            下 = 润色
 *
 * **灯的脸色全部来自库**（`GET /api/novels/:id/agents`）：
 * 五盏读 generation_tasks，执笔/润色读 chapter_texts 的初稿、定稿产物数；
 * 案心由七盏归总。灯下留白就是"这一阶段还没开工"。
 * 页面**不摆任何静态状态**——读不到就说读不到，不拿假数糊过去。
 *
 * 每 5 秒重取一次：Agent 是在后台干活，界面得跟着动。
 */

const STATE_LABEL = { done: '已成', running: '在写', idle: '待命', failed: '折笔' };

// 灯位方位写死；按 id 取节点，不怕后端调整数组顺序
const RING = {
  top: ['world', 'outline'],
  left: ['character', 'location'],
  right: ['chapter', 'writer'],
  bottom: ['polish'],
};

const BUBBLE_HALF = 152; // 浮签半宽，用来夹左右边距
const POLL_MS = 5000;

export default function Workspace() {
  const { novel } = useWorkbench();
  const mapRef = useRef(null);
  const [status, setStatus] = useState(null); // { nodes, hub }
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [bubble, setBubble] = useState(null); // { info, x, y, above }

  useEffect(() => {
    if (!novel?.id) {
      setStatus(null);
      setLoaded(true);
      setError('');
      return undefined;
    }
    let active = true;
    const load = () => {
      api.workflow(novel.id)
        .then((result) => { if (active && result) { setStatus(result); setError(''); } })
        .catch((cause) => { if (active) setError(cause.message || '读不到工作流状态'); })
        .finally(() => { if (active) setLoaded(true); });
    };
    setLoaded(false);
    load();
    const timer = window.setInterval(load, POLL_MS);
    return () => { active = false; window.clearInterval(timer); };
  }, [novel?.id]);

  const byId = Object.fromEntries((status?.nodes ?? []).map((node) => [node.id, node]));

  /**
   * 浮签落点：以节点底边中点为准；节点已过案面 62% 高度就翻到头顶，
   * 左右夹到画布边内。坐标全用 rect 差值，滚动位置天然抵销。
   */
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

  if (!status) {
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
      <p className="wsc__caption">案上七盏灯 —— 悬灯即见近况，灯下留白是它闲着</p>

      <section className="wsc__map" ref={mapRef} aria-label="Agent 协作链路">
        <div className="wsc__lines" aria-hidden="true">
          <span className="wsc__line wsc__line--v wsc__line--top" />
          <span className="wsc__line wsc__line--v wsc__line--bottom" />
          <span className="wsc__line wsc__line--h wsc__line--left" />
          <span className="wsc__line wsc__line--h wsc__line--right" />
        </div>

        <div className="wsc__orbit wsc__orbit--top">
          {RING.top.map((id) => <Lamp key={id} agent={byId[id]} bind={bind} />)}
        </div>
        <div className="wsc__orbit wsc__orbit--side wsc__orbit--left">
          {RING.left.map((id) => <Lamp key={id} agent={byId[id]} bind={bind} />)}
        </div>

        <button type="button" className={`wsc__hub is-${status.hub.state}`} {...bind({ ...status.hub, id: 'hub', name: '中心 Agent', mark: '灵' })}>
          <span className="wsc__hub-seal">灵</span>
          <span className="wsc__hub-name">中心 Agent</span>
          <span className="wsc__hub-state"><i />{STATE_LABEL[status.hub.state]}</span>
        </button>

        <div className="wsc__orbit wsc__orbit--side wsc__orbit--right">
          {RING.right.map((id) => <Lamp key={id} agent={byId[id]} bind={bind} />)}
        </div>
        <div className="wsc__orbit wsc__orbit--bottom">
          {RING.bottom.map((id) => <Lamp key={id} agent={byId[id]} bind={bind} />)}
        </div>

        {/* 浮签挂在 map 内：坐标以 map 为参照（ref 所在），随画布一起滚 */}
        {bubble && <Bubble info={bubble.info} x={bubble.x} y={bubble.y} above={bubble.above} />}
      </section>

      {/* 明暗图例：灯的四种脸色，一眼对上 */}
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
 * 浮签：当前在做什么 / 统计 / 最近更新。
 * 版式里原本还有一条"本轮 token"墨条 —— 库里没有这个数据源，已去掉，不摆假数。
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
      <p className="wsc__bubble-row"><span>当前</span>{info.current || '没有在跑的任务'}</p>
      <p className="wsc__bubble-row"><span>统计</span>{info.summary}</p>
      <p className="wsc__bubble-row"><span>更新</span>{info.updated_at || '—'}</p>
    </div>
  );
}

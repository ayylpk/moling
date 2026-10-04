import { useState } from 'react';
import BlockTitle from '../components/BlockTitle.jsx';
import { AGENTS } from '../lib/workbenchData.js';

const stateLabel = { done: '已成', running: '在写', idle: '待命', failed: '折笔' };

export default function Collaboration({ onOpenManuscript }) {
  const [selected, setSelected] = useState('writer');
  const active = AGENTS.find((agent) => agent.id === selected) || AGENTS[0];

  return (
    <main className="wb-page collaboration enter">
      <BlockTitle mark="灵" name="协作总览" anno="中心 Agent · 任务依赖 · ask-human" />
      <div className="collab__toolbar">
        <div>
          <p className="eyebrow">当前工作流</p>
          <h2 className="collab__headline">让故事从一条线，长成一部书</h2>
        </div>
        <button className="btn btn--primary" type="button" onClick={() => onOpenManuscript?.()}>打开书稿</button>
      </div>

      <div className="workflow-guide"><span><b>01</b> 上游约束</span><i /><span><b>02</b> 中心调度</span><i /><span><b>03</b> 产出与校验</span></div>
      <section className="agent-map" aria-label="Agent 协作图">
        <div className="agent-map__lines" aria-hidden="true">
          <span className="agent-line agent-line--top" />
          <span className="agent-line agent-line--left" />
          <span className="agent-line agent-line--right" />
          <span className="agent-line agent-line--bottom" />
        </div>
        <div className="agent-orbit agent-orbit--top">
          <AgentNode agent={AGENTS[0]} selected={selected === AGENTS[0].id} onSelect={setSelected} />
          <AgentNode agent={AGENTS[3]} selected={selected === AGENTS[3].id} onSelect={setSelected} />
        </div>
        <div className="agent-orbit agent-orbit--side agent-orbit--left">
          <AgentNode agent={AGENTS[1]} selected={selected === AGENTS[1].id} onSelect={setSelected} />
          <AgentNode agent={AGENTS[2]} selected={selected === AGENTS[2].id} onSelect={setSelected} />
        </div>
        <button className={`central-agent is-${active.state}`} type="button" onClick={() => setSelected('writer')}>
          <span className="central-agent__seal">灵</span>
          <span className="central-agent__name">中心 Agent</span>
          <span className="central-agent__state"><i /> {active.state === 'running' ? '正在协调' : '保持清醒'}</span>
        </button>
        <div className="agent-orbit agent-orbit--side agent-orbit--right">
          <AgentNode agent={AGENTS[4]} selected={selected === AGENTS[4].id} onSelect={setSelected} />
          <AgentNode agent={AGENTS[5]} selected={selected === AGENTS[5].id} onSelect={setSelected} />
        </div>
        <div className="agent-orbit agent-orbit--bottom">
          <AgentNode agent={AGENTS[6]} selected={selected === AGENTS[6].id} onSelect={setSelected} />
        </div>
      </section>

      <section className="agent-inspector card">
        <div className="agent-inspector__head">
          <div><span className={`status is-${active.state === 'running' ? 'writing' : active.state}`}>{stateLabel[active.state]}</span><h3>{active.name}</h3></div>
          <span className="anno">stage · {active.stage}</span>
        </div>
        <p className="agent-inspector__summary">{active.summary}</p>
        <div className="agent-inspector__meta"><span>{active.detail}</span><span>最近活动 · 刚刚</span></div>
      </section>
    </main>
  );
}

function AgentNode({ agent, selected, onSelect }) {
  return (
    <button className={`agent-node is-${agent.state}${selected ? ' is-selected' : ''}`} type="button" onClick={() => onSelect(agent.id)} title={`${agent.name}：${agent.summary}`}>
      <span className="agent-node__mark">{agent.mark}</span>
      <span className="agent-node__name">{agent.name}</span>
      <span className="agent-node__summary">{agent.summary}</span>
      <span className="agent-node__state"><i />{stateLabel[agent.state]}</span>
    </button>
  );
}

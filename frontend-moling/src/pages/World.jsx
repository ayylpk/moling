import { useEffect, useState } from 'react';
import BlockTitle from '../components/BlockTitle.jsx';
import Modal from '../components/Modal.jsx';
import { useWorkbench } from '../layout/WorkbenchLayout.jsx';
import { api } from '../api/client.js';

/**
 * 设定页（世界观）：多版本卡片流 + 草案审核区。
 * 内容贴 10/2 真产物 world.json；接 GET /api/worlds/current?novelId=。
 * 改内容走 POST 起新版（v+1），禁原地 PATCH —— 原地改会让下游产物变「无主」。
 *
 * ── 草案动线（10/8）──
 * 生成 → 后端存「待审核草案」（drafts 表，刷新不丢）→ 页面展示草案 + 四个动作：
 * 生成草案 / 重新生成（覆盖草案，不动正式表）/ 采纳并保存（写正式表新版本）/ 放弃草案。
 * 一次只做这一个阶段，采纳是唯一的"写正式表"入口。
 */

const asArray = (value) => (Array.isArray(value) ? value : []);

export default function World() {
  const { novel } = useWorkbench();
  const [worlds, setWorlds] = useState([]);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ name: '', premise: '', rules: '', places: '', terms: '', forbidden: '' });

  /* ---------- 草案状态 ---------- */
  const [draft, setDraft] = useState(null);       // 待审核草案（后端 drafts 表的 world 条目）
  const [generating, setGenerating] = useState(false); // 正在生成草案：期间所有动作禁用
  const [acting, setActing] = useState('');        // 'adopt' | 'discard' | ''
  const [draftError, setDraftError] = useState('');
  const [askOpen, setAskOpen] = useState(false);  // 「要什么样的世界」输入框
  const [need, setNeed] = useState('');
  const [name, setName] = useState('');
  const [lastNeed, setLastNeed] = useState('');   // 上一次生成用的 need（重新生成时预填）

  useEffect(() => {
    if (!novel?.id) { setWorlds([]); setDraft(null); return; }
    let active = true;
    api.listWorlds(novel.id).then((items) => { if (active) setWorlds(Array.isArray(items) ? items : []); }).catch((cause) => { if (active) setError(cause.message); });
    api.listDrafts(novel.id, 'world')
      .then((items) => { if (active) setDraft(items?.[0] ?? null); })
      .catch(() => { if (active) setDraft(null); });
    return () => { active = false; };
  }, [novel?.id]);

  const current = worlds[0];
  const update = (key) => (event) => setForm((value) => ({ ...value, [key]: event.target.value }));
  const createWorld = async (event) => {
    event.preventDefault(); setError('');
    if (!form.name.trim() || !form.premise.trim()) { setError('世界观名称和总设定不能为空。'); return; }
    setSaving(true);
    const split = (value) => value.split(/[\n，,、]/).map((item) => item.trim()).filter(Boolean);
    try {
      const created = await api.createWorld(novel.id, { name: form.name.trim(), premise: form.premise.trim(), rules: split(form.rules).map((ability) => ({ ability, cost: '', limit: '' })), places: split(form.places), terms: split(form.terms).map((name) => ({ name })), forbidden: split(form.forbidden) });
      setWorlds((items) => [created, ...items]); setCreating(false); setForm({ name: '', premise: '', rules: '', places: '', terms: '', forbidden: '' });
    } catch (cause) { setError(cause.message || '世界观保存失败。'); } finally { setSaving(false); }
  };

  /* ---------- 草案动作 ---------- */
  const generateDraft = async (event) => {
    event.preventDefault();
    if (!novel?.id || !need.trim()) return;
    setGenerating(true); setDraftError('');
    try {
      const created = await api.generateWorldDraft(novel.id, need.trim(), name.trim() || undefined);
      setDraft(created);
      setLastNeed(need.trim());
      setAskOpen(false);
    } catch (cause) { setDraftError(cause.message || '草案生成失败。'); } finally { setGenerating(false); }
  };
  const adoptDraft = async () => {
    if (!novel?.id || !draft) return;
    setActing('adopt'); setDraftError('');
    try {
      const world = await api.adoptDraft(novel.id, 'world', draft.targetKey);
      setWorlds((items) => [world, ...items.filter((item) => item.id !== world.id)]);
      setDraft(null); setNeed(''); setName('');
    } catch (cause) { setDraftError(cause.message || '采纳失败。'); } finally { setActing(''); }
  };
  const discardDraft = async () => {
    if (!novel?.id || !draft) return;
    setActing('discard'); setDraftError('');
    try {
      await api.discardDraft(novel.id, 'world', draft.targetKey);
      setDraft(null);
    } catch (cause) { setDraftError(cause.message || '放弃失败。'); } finally { setActing(''); }
  };

  const draftContent = draft?.parsed ?? null;

  return (
    <main className="wb-page enter">
      <BlockTitle mark="设" name="设定 · 世界观" />

      {/* 版本签：当前生效挂朱点（激活职），新版是「起」不是「改」 */}
      <div className="vstrip">
        <span className="vchip is-current">{current ? `v${current.version} · 当前生效` : '尚未建立世界观'}</span>
        <button type="button" className="btn btn--primary btn--sm" disabled={!novel || generating} onClick={() => { setError(''); setDraftError(''); setAskOpen(true); }} title="生成一份待审核的世界观草案，采纳后才成为正式版本">生成世界观草案</button>
        {draft && (
          <button type="button" className="btn btn--sm" disabled={generating} onClick={() => { setDraftError(''); setNeed(lastNeed); setAskOpen(true); }}>重新生成</button>
        )}
        <button type="button" className="btn btn--sm" disabled={!novel} onClick={() => { setError(''); setCreating(true); }}>起新版</button>
      </div>

      {/* 待审核草案：生成之后、采纳之前，它只住 drafts 表 */}
      {draft && (
        <section className="block">
          <BlockTitle mark="审" name="待审核草案" />
          <div className="card">
            <div className="book__head">
              <span className="book__title">{draftContent?.name || '世界观草案'}</span>
              <span className="status is-writing">草案 · 未落库 · {draft.updatedAt || ''}</span>
            </div>
            <div className="field">
              <p className="field__k" data-en="premise">总设定</p>
              <p className="field__v field__v--prose">{draftContent?.premise || '（空）'}</p>
            </div>
            {asArray(draftContent?.rules).length > 0 && (
              <div className="field">
                <p className="field__k">规则（每条都要有代价）</p>
                <ol className="rules">
                  {asArray(draftContent.rules).map((rule, index) => (
                    <li className="rule-item" key={`${rule?.ability}-${index}`}>
                      <span className="rule-no">{index + 1}</span>
                      <div>
                        <p className="field__v field__v--prose">{rule?.ability}</p>
                        {(rule?.cost || rule?.limit) && <p className="anno" style={{ marginTop: 4 }}>{[rule?.cost, rule?.limit].filter(Boolean).join(' · ')}</p>}
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            )}
            {asArray(draftContent?.places).length > 0 && (
              <div className="field">
                <p className="field__k">场景</p>
                <div className="chip-row">
                  {asArray(draftContent.places).map((place, index) => <span className="chip" key={`${String(place)}-${index}`}>{typeof place === 'string' ? place : place?.name || JSON.stringify(place)}</span>)}
                </div>
              </div>
            )}
            {draftError && <p className="novel-form__error">{draftError}</p>}
            <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
              <button type="button" className="btn btn--primary btn--sm" disabled={acting !== '' || generating} onClick={adoptDraft}>{acting === 'adopt' ? '正在保存…' : '采纳并保存'}</button>
              <button type="button" className="btn btn--sm" disabled={acting !== '' || generating} onClick={discardDraft}>{acting === 'discard' ? '正在放弃…' : '放弃草案'}</button>
              <span className="anno">采纳后写入正式版本 v{(current?.version ?? 0) + 1}；放弃不影响已保存内容。</span>
            </div>
          </div>
        </section>
      )}
      {generating && <p className="anno">正在生成世界观草案……一次只做这一个阶段，生成完会停下来等你审核。</p>}

      {current ? <div className="card">
        <div className="field">
          <p className="field__k" data-en="premise">总设定</p>
          <p className="field__v field__v--prose">{current.premise}</p>
        </div>
      </div> : <div className="card"><p className="anno">这本书还没有世界观。先起第一版（手写，或让 Agent 生成草案再采纳），后续的大纲与角色才有地基。</p></div>}

      <section className="block">
        <BlockTitle mark="律" name="世界规则" />
        <div className="card" style={{ padding: '8px 22px 14px' }}>
          <ol className="rules">
            {(current?.rules || []).map((rule, index) => <li className="rule-item" key={`${rule.ability}-${index}`}><span className="rule-no">{index + 1}</span><div><p className="field__k">世界规则</p><p className="field__v field__v--prose">{rule.ability}</p>{(rule.cost || rule.limit) && <p className="anno" style={{ marginTop: 6 }}>{[rule.cost, rule.limit].filter(Boolean).join(' · ')}</p>}</div></li>)}
            {!current?.rules?.length && <li className="rule-item"><span className="anno">暂无规则记录。</span></li>}
          </ol>
        </div>
      </section>

      <section className="block">
        <BlockTitle mark="名" name="场景" />
        <div className="card">
          <div className="chip-row">
            {(current?.places || []).map((place, index) => <span className="chip" key={`${String(place)}-${index}`}>{typeof place === 'string' ? place : place.name || JSON.stringify(place)}</span>)}
            {!current?.places?.length && <span className="anno">暂无场景。</span>}
          </div>
        </div>
      </section>
      {creating && <Modal onSubmit={createWorld} onBackdrop={() => setCreating(false)} onEscape={() => setCreating(false)}><div className="novel-modal__head"><div><p className="eyebrow">WORLD VERSION</p><h2>起一版世界观</h2></div><button type="button" className="novel-modal__close" onClick={() => setCreating(false)}>×</button></div><p className="anno">每次保存都会产生新版本，旧版本保留，不覆盖已经发生过的创作依据。</p><label className="novel-form__field"><span>世界名称</span><input autoFocus value={form.name} onChange={update('name')} placeholder="例如：临江重生录" /></label><label className="novel-form__field"><span>总设定</span><textarea rows="4" value={form.premise} onChange={update('premise')} placeholder="故事发生在哪里，主角面对的根本命题是什么？" /></label><label className="novel-form__field"><span>规则 <i>每行一条</i></span><textarea rows="3" value={form.rules} onChange={update('rules')} placeholder="重来的次数只有一次\n记忆会在梦中失真" /></label><div className="novel-form__grid"><label className="novel-form__field"><span>场景 <i>每行或逗号分隔</i></span><input value={form.places} onChange={update('places')} placeholder="城市，学校，旧楼" /></label><label className="novel-form__field"><span>专名 <i>每行或逗号分隔</i></span><input value={form.terms} onChange={update('terms')} placeholder="灵脉，回声井" /></label></div><label className="novel-form__field"><span>禁语 <i>每行一条</i></span><input value={form.forbidden} onChange={update('forbidden')} placeholder="万能的、嘴角勾起" /></label>{error && <p className="novel-form__error">{error}</p>}<div className="novel-modal__actions"><button type="button" className="btn" onClick={() => setCreating(false)}>取消</button><button type="submit" className="btn btn--primary" disabled={saving}>{saving ? '正在起稿…' : '保存为新版'}</button></div></Modal>}

      {askOpen && (
        <Modal onSubmit={generateDraft} onBackdrop={() => setAskOpen(false)} onEscape={() => setAskOpen(false)}>
          <div className="novel-modal__head">
            <div><p className="eyebrow">WORLD DRAFT</p><h2>{draft ? '重新生成世界观草案' : '生成世界观草案'}</h2></div>
            <button type="button" className="novel-modal__close" onClick={() => setAskOpen(false)}>×</button>
          </div>
          <p className="anno">生成的是**待审核草案**：不会动已保存的版本，你审核后点「采纳并保存」才生效。</p>
          <label className="novel-form__field"><span>这本书要什么样的世界</span><textarea autoFocus rows="4" value={need} onChange={(event) => setNeed(event.target.value)} placeholder="题材、口味、必须写死的规则（例如「穿越必须付出代价」）、必须禁止的东西、势力格局。" /></label>
          <label className="novel-form__field"><span>世界名称 <i>可选</i></span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="不填就用书名" /></label>
          {draftError && <p className="novel-form__error">{draftError}</p>}
          <div className="novel-modal__actions">
            <button type="button" className="btn" onClick={() => setAskOpen(false)}>取消</button>
            <button type="submit" className="btn btn--primary" disabled={generating || !need.trim()}>{generating ? '正在生成…' : '生成草案'}</button>
          </div>
        </Modal>
      )}
    </main>
  );
}

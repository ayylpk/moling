import { useEffect, useState } from 'react';
import BlockTitle from '../components/BlockTitle.jsx';
import Modal from '../components/Modal.jsx';
import { useWorkbench } from '../layout/WorkbenchLayout.jsx';
import { api } from '../api/client.js';

/**
 * 设定页（世界观）：多版本卡片流。
 * 内容贴 10/2 真产物 world.json；接 GET /api/worlds/current?novelId=。
 * 改内容走 POST 起新版（v+1），禁原地 PATCH —— 原地改会让下游产物变「无主」。
 */

// premise 真值（一字未动，它是下游一切的地基）
export default function World() {
  const { novel } = useWorkbench();
  const [worlds, setWorlds] = useState([]);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ name: '', premise: '', rules: '', places: '', terms: '', forbidden: '' });
  useEffect(() => {
    if (!novel?.id) { setWorlds([]); return; }
    let active = true;
    api.listWorlds(novel.id).then((items) => { if (active) setWorlds(Array.isArray(items) ? items : []); }).catch((cause) => { if (active) setError(cause.message); });
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
  return (
    <main className="wb-page enter">
      <BlockTitle mark="设" name="设定 · 世界观" />

      {/* 版本签：当前生效挂朱点（激活职），新版是「起」不是「改」 */}
      <div className="vstrip">
        <span className="vchip is-current">{current ? `v${current.version} · 当前生效` : '尚未建立世界观'}</span>
        <button type="button" className="btn btn--primary btn--sm" disabled={!novel} onClick={() => { setError(''); setCreating(true); }}>起新版</button>
      </div>

      {current ? <div className="card">
        <div className="field">
          <p className="field__k" data-en="premise">总设定</p>
          <p className="field__v field__v--prose">{current.premise}</p>
        </div>
      </div> : <div className="card"><p className="anno">这本书还没有世界观。先起第一版，中心 Agent 才能沿着规则继续搭建大纲与角色。</p></div>}

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
    </main>
  );
}

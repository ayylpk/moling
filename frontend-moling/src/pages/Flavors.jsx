import { useCallback, useEffect, useState } from 'react';
import BlockTitle from '../components/BlockTitle.jsx';
import { api } from '../api/client.js';

/**
 * 题材库：类型 / 文风两个目录的读写口。
 *
 * 这一页和别的页不一样 —— **它不依赖某一本书**。类型与文风是全局共享的配置：
 * 建书表单的下拉、以及每章注入给 writer/polisher 的片段，都取自这两个目录。
 * 所以它不读 useWorkbench 里的 novel，也不存在"哪本书的题材"这种说法。
 *
 * 两条动线：
 *   ① 从素材生成 —— 传图 / 文字 / .docx → 模型给出一份类型 + 一份文风草案 → 改 → 勾选保存
 *   ② 维护已有的 —— 列表 / 编辑 / 重命名 / 删除（删除只是挪进隔离区，不真删）
 */

const DIMENSIONS = ['类型', '文风'];

/** 片段注入给谁 —— 只影响标签显示。有没有这一片由后端的 agents 决定，不在这里写死 */
const AGENT_LABELS = {
  'story-planner': '世界观',
  character: '角色',
  location: '地点',
  architect: '架构师',
  actor: '裁决',
  writer: '执笔',
  polisher: '润色',
};

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp'];
const MAX_BYTES = 10 * 1024 * 1024;

/** 读成 base64（去掉 data URI 前缀）。图片和 .docx 都走它 */
const readBase64 = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => {
    const result = String(reader.result || '');
    resolve(result.slice(result.indexOf(',') + 1));
  };
  reader.onerror = () => reject(new Error('读不到这个文件'));
  reader.readAsDataURL(file);
});

/**
 * 文件 → 请求体。
 *
 * 三种素材互斥，字段名和规则都要和后端对齐：
 *   图片 → { image: { mediaType, base64 } }
 *   .docx → { document: { base64 } }（后端自己解 zip，前端不解）
 *   .txt/.md → { text }
 * **文件内容不落任何地方** —— 读进内存、发出去、然后就没了。
 */
const toMaterial = async (file) => {
  if (!file) throw new Error('先选一个文件');
  if (file.size > MAX_BYTES) throw new Error(`文件 ${(file.size / 1024 / 1024).toFixed(1)}MB，超过 10MB，请先压缩`);

  const name = file.name.toLowerCase();
  if (IMAGE_TYPES.includes(file.type)) return { image: { mediaType: file.type, base64: await readBase64(file) } };
  if (name.endsWith('.docx')) return { document: { base64: await readBase64(file) } };
  if (name.endsWith('.doc')) throw new Error('.doc 是 Word 的老格式（不是 zip），读不了。请在 Word 里另存为 .docx');
  if (name.endsWith('.txt') || name.endsWith('.md')) return { text: await file.text() };
  throw new Error('只认图片、.txt、.md、.docx');
};

/** 一组片段编辑框。名字 + 每片一个 textarea —— 生成结果和"编辑已有"共用 */
function FragmentFields({ agents, name, fragments, onName, onFragment, nameLabel = '名字' }) {
  return (
    <>
      <label className="novel-form__field">
        <span>{nameLabel} <i>将作为目录名，不能含点号</i></span>
        <input value={name} onChange={(event) => onName(event.target.value)} placeholder="例如：都市悬疑" />
      </label>
      <div style={{ display: 'grid', gap: 10, marginTop: 10 }}>
        {agents.map((agent) => (
          <label className="novel-form__field" key={agent}>
            <span>
              {agent}.md
              <i style={{ marginLeft: 6 }}>注入给{AGENT_LABELS[agent] || agent}</i>
            </span>
            <textarea
              rows={4}
              value={fragments[agent] ?? ''}
              onChange={(event) => onFragment(agent, event.target.value)}
              placeholder="这一片留空＝不生成这个文件"
            />
          </label>
        ))}
      </div>
    </>
  );
}

export default function Flavors() {
  /** 每个维度该有哪几片（后端给），以及维度下的条目 */
  const [agents, setAgents] = useState({ 类型: [], 文风: [] });
  const [items, setItems] = useState({ 类型: [], 文风: [] });
  const [tab, setTab] = useState('类型');
  const [loading, setLoading] = useState(true);

  const [file, setFile] = useState(null);
  const [draft, setDraft] = useState(null);
  const [picked, setPicked] = useState({ 类型: true, 文风: true });
  const [editing, setEditing] = useState(null);

  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [genre, style] = await Promise.all(DIMENSIONS.map((dimension) => api.listFlavorDimension(dimension)));
      setAgents({ 类型: genre?.agents ?? [], 文风: style?.agents ?? [] });
      setItems({ 类型: genre?.items ?? [], 文风: style?.items ?? [] });
      setError('');
    } catch (cause) {
      setError(cause.message || '读不到题材库，检查服务是否启动。');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  /* ---------- ① 从素材生成 ---------- */
  const generate = async () => {
    setBusy('generating');
    setError('');
    setNotice('');
    setDraft(null);
    try {
      const material = await toMaterial(file);
      const result = await api.generateFlavor(material);
      setDraft(result);
      setPicked({ 类型: true, 文风: true });
    } catch (cause) {
      setError(cause.message || '生成失败');
    } finally {
      setBusy('');
    }
  };

  const patchDraft = (dimension, patch) =>
    setDraft((current) => (current ? { ...current, [dimension === '类型' ? 'genre' : 'style']: { ...(dimension === '类型' ? current.genre : current.style), ...patch } } : current));

  const draftOf = (dimension) => (draft ? (dimension === '类型' ? draft.genre : draft.style) : null);

  /** 保存勾选的那几个。逐条提交：一个是重名被拒，不该连累另一个 */
  const saveDraft = async () => {
    const targets = DIMENSIONS.filter((dimension) => picked[dimension]);
    if (targets.length === 0) { setError('先勾选要保存哪一个'); return; }

    setBusy('saving');
    setError('');
    setNotice('');
    const saved = [];
    const failed = [];
    for (const dimension of targets) {
      const flavor = draftOf(dimension);
      try {
        await api.createFlavor(dimension, flavor.name, flavor.fragments);
        saved.push(`${dimension}「${flavor.name}」`);
      } catch (cause) {
        failed.push(`${dimension}「${flavor.name}」：${cause.message}`);
      }
    }
    if (saved.length > 0) setNotice(`已保存 ${saved.join('、')}`);
    if (failed.length > 0) setError(failed.join('；'));
    setBusy('');
    await load();
  };

  /* ---------- ② 维护已有条目 ---------- */
  const startEdit = async (dimension, name) => {
    setBusy('opening');
    setError('');
    try {
      const item = await api.getFlavor(dimension, name);
      setEditing({ dimension, original: name, name: item.name, fragments: { ...item.fragments } });
    } catch (cause) {
      setError(cause.message || '读不到这个条目');
    } finally {
      setBusy('');
    }
  };

  const saveEdit = async () => {
    setBusy('saving');
    setError('');
    setNotice('');
    try {
      await api.updateFlavor(editing.dimension, editing.original, { name: editing.name, fragments: editing.fragments });
      setNotice(`已更新 ${editing.dimension}「${editing.name}」`);
      setEditing(null);
      await load();
    } catch (cause) {
      setError(cause.message || '保存失败');
    } finally {
      setBusy('');
    }
  };

  const rename = async (dimension, name) => {
    const next = window.prompt(`把「${name}」改成：`, name)?.trim();
    if (!next || next === name) return;
    setError('');
    setNotice('');
    try {
      await api.updateFlavor(dimension, name, { name: next });
      setNotice(`「${name}」已改名为「${next}」`);
      await load();
    } catch (cause) {
      setError(cause.message || '改名失败');
    }
  };

  const remove = async (dimension, name) => {
    const ok = window.confirm(`删除「${dimension}／${name}」？\n\n它不会被真删掉，只是挪进项目里的隔离区（.workbuddy/flavor-trash），随时能搬回来。`);
    if (!ok) return;
    setError('');
    setNotice('');
    try {
      const result = await api.removeFlavor(dimension, name);
      setNotice(`已删除「${name}」（挪到了隔离区，没真删）\n${result.movedTo || ''}`);
      await load();
    } catch (cause) {
      setError(cause.message || '删除失败');
    }
  };

  const shown = items[tab] || [];

  return (
    <main className="wb-page enter">
      <BlockTitle mark="类" name="题材库" />

      <p className="anno" style={{ lineHeight: 2 }}>
        这里的类型与文风是全局共享的：建书表单的下拉、以及每章注入给写手和润色 agent 的片段，都取自这两个目录。
        加一个类型 = 加一个目录 + 几个片段文件，代码不用动。
      </p>

      {/* ==================== 一、从素材生成 ==================== */}
      <section className="block">
        <BlockTitle mark="生" name="从素材生成" />

        <div className="card">
          <p className="anno" style={{ lineHeight: 2 }}>
            传一张图、一段文字、或一个 .docx。模型读完给出一份类型草案（7 片）和一份文风草案（2 片）。
            素材用完即弃、不保存；草案可以直接改，勾选要留下的再落盘。
          </p>

          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 12 }}>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif,image/bmp,.txt,.md,.docx"
              onChange={(event) => { setFile(event.target.files?.[0] ?? null); setNotice(''); setError(''); }}
            />
            <button type="button" className="btn btn--primary" disabled={!file || busy === 'generating'} onClick={generate}>
              {busy === 'generating' ? '正在读取素材…（约 40 秒）' : '生成草案'}
            </button>
            {file && <span className="anno">{file.name}</span>}
          </div>

          {draft && (
            <div style={{ marginTop: 16 }}>
              {draft.portrait && (
                <div className="field">
                  <p className="field__k" data-en="portrait">模型读到的</p>
                  <p className="field__v">{draft.portrait}</p>
                  <p className="anno" style={{ marginTop: 6 }}>
                    这一步用视觉模型读图，再由文本模型写片段。改动草案不会影响素材 —— 素材早就没了。
                  </p>
                </div>
              )}

              {DIMENSIONS.map((dimension) => {
                const flavor = draftOf(dimension);
                if (!flavor) return null;
                return (
                  <div key={dimension} style={{ marginTop: 16, paddingTop: 14, borderTop: '0.5px solid rgba(33,30,24,.12)' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <input
                        type="checkbox"
                        checked={picked[dimension]}
                        onChange={(event) => setPicked((current) => ({ ...current, [dimension]: event.target.checked }))}
                      />
                      <span className="eyebrow" style={{ margin: 0 }}>
                        保存这份{dimension}（{Object.keys(flavor.fragments || {}).length} 片）
                      </span>
                    </label>
                    <FragmentFields
                      agents={agents[dimension]}
                      name={flavor.name}
                      fragments={flavor.fragments || {}}
                      onName={(value) => patchDraft(dimension, { name: value })}
                      onFragment={(agent, value) => patchDraft(dimension, { fragments: { ...flavor.fragments, [agent]: value } })}
                      nameLabel={`${dimension}名字`}
                    />
                  </div>
                );
              })}

              <div className="novel-modal__actions" style={{ marginTop: 14 }}>
                <button type="button" className="btn" onClick={() => { setDraft(null); setError(''); }}>丢弃草案</button>
                <button type="button" className="btn btn--primary" disabled={busy === 'saving'} onClick={saveDraft}>
                  {busy === 'saving' ? '保存中…' : '保存勾选的'}
                </button>
              </div>
            </div>
          )}

          {error && <p className="novel-form__error" role="alert" style={{ marginTop: 10 }}>{error}</p>}
          {notice && <p className="anno" style={{ marginTop: 10, whiteSpace: 'pre-line' }}>{notice}</p>}
        </div>
      </section>

      {/* ==================== 二、已有的 ==================== */}
      <section className="block">
        <BlockTitle mark="库" name="已有类型与文风" />

        <div className="chip-row" style={{ marginBottom: 12 }}>
          {DIMENSIONS.map((dimension) => (
            <span
              className={`chip${tab === dimension ? ' is-active' : ''}`}
              style={tab === dimension ? { borderColor: 'rgba(33,30,24,.4)', color: 'var(--m-ink)' } : undefined}
              onClick={() => { setTab(dimension); setEditing(null); }}
              key={dimension}
            >
              {dimension} · {items[dimension]?.length ?? 0}
            </span>
          ))}
          <span className="chip" onClick={load}>刷新</span>
        </div>

        {loading && <p className="anno">正在读题材库……</p>}
        {!loading && shown.length === 0 && <p className="anno">这个维度下还没有条目。</p>}

        <div className="desk__grid">
          {shown.map((item) => (
            <article className="card" key={`${tab}-${item.name}`}>
              <div className="book__head">
                <span className="book__title">{item.name}</span>
                <span className="chip">{Object.keys(item.fragments || {}).length} 片</span>
              </div>

              {item.missing?.length > 0 && (
                <p className="anno" style={{ marginTop: 6 }}>缺：{item.missing.map((agent) => AGENT_LABELS[agent] || agent).join('、')}</p>
              )}

              {editing && editing.dimension === tab && editing.original === item.name ? (
                <div style={{ marginTop: 10 }}>
                  <FragmentFields
                    agents={agents[tab]}
                    name={editing.name}
                    fragments={editing.fragments}
                    onName={(value) => setEditing((current) => ({ ...current, name: value }))}
                    onFragment={(agent, value) => setEditing((current) => ({ ...current, fragments: { ...current.fragments, [agent]: value } }))}
                  />
                  <div className="novel-modal__actions" style={{ marginTop: 12 }}>
                    <button type="button" className="btn btn--sm" onClick={() => setEditing(null)}>取消</button>
                    <button type="button" className="btn btn--primary btn--sm" disabled={busy === 'saving'} onClick={saveEdit}>
                      {busy === 'saving' ? '保存中…' : '保存'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="chip-row" style={{ marginTop: 10 }}>
                  <span className="chip" onClick={() => startEdit(tab, item.name)}>编辑</span>
                  <span className="chip" onClick={() => rename(tab, item.name)}>重命名</span>
                  <span className="chip chip--forbid" onClick={() => remove(tab, item.name)}>删除</span>
                </div>
              )}
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

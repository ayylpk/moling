import { useState } from 'react';
import BlockTitle from '../components/BlockTitle.jsx';
import { NOVEL_STATUS_META } from '../lib/enums.js';
import { useWorkbench } from '../layout/WorkbenchLayout.jsx';
import { api } from '../api/client.js';

/**
 * 书架：一卡一书，数据来自 `GET /api/novels`（目录库 novels 表）。
 *
 * 卡上四样都取自后端真字段：
 *   标题 title ／ 状态 status ／ 题材 genre + 文风 style ／ 目标字数 target_words
 *   + 主题 themes（JSON 数组）+ 简介 description/logline
 * 点卡 = 把当前小说切到这本（切完去书稿页看正文）。
 *
 * 注意：卡上**没有**六阶进度条 —— 那是 generation 的任务表，当前基座
 * （agent/storage/server.ts）没有这个接口。等接口有了再补，先不摆假进度。
 */
/** 目录库把 themes 存成 JSON 文本，接口原样返回字符串 —— 两种形态都吃 */
const readThemes = (value) => {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export default function Desk() {
  const { novels, novelsLoaded, novel, setNovelId, setNovels } = useWorkbench();
  const [filter, setFilter] = useState('all');
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ title: '', genre: '', style: '', description: '', logline: '', target_words: '', themes: '' });

  const shown = filter === 'all' ? novels : novels.filter((item) => item.status === filter);
  const update = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const createNovel = async (event) => {
    event.preventDefault();
    setError('');
    const title = form.title.trim();
    if (!title) { setError('请先填写小说名称。'); return; }
    const slugBase = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
    const slug = slugBase || `novel-${Date.now().toString(36)}`;
    const themes = form.themes.split(/[，,、]/).map((item) => item.trim()).filter(Boolean);
    const targetWords = form.target_words.trim() ? Number(form.target_words) : 0;
    if (!Number.isInteger(targetWords) || targetWords < 0) { setError('目标字数请填写非负整数。'); return; }
    setSaving(true);
    try {
      const created = await api.createNovel({ slug, title, genre: form.genre.trim(), style: form.style.trim(), description: form.description.trim(), logline: form.logline.trim(), target_words: targetWords, themes });
      setNovels((current) => [created, ...current]);
      setNovelId(created.id);
      setCreating(false);
      setForm({ title: '', genre: '', style: '', description: '', logline: '', target_words: '', themes: '' });
    } catch (cause) { setError(cause.message || '创建失败，请检查服务是否启动。'); }
    finally { setSaving(false); }
  };
  const chips = [
    { key: 'all', label: '全部' },
    ...Object.entries(NOVEL_STATUS_META).map(([key, meta]) => ({ key, label: meta.label })),
  ];

  return (
    <main className="wb-page enter">
      <BlockTitle mark="台" name="书架" />

      {/* 状态筛选 + 新建（一页至多一枚朱砂主按钮） */}
      <div className="desk__bar">
        <div className="chip-row">
          {chips.map((chip) => (
            <span
              className={`chip${filter === chip.key ? ' is-active' : ''}`}
              style={filter === chip.key ? { borderColor: 'rgba(33,30,24,.4)', color: 'var(--m-ink)' } : undefined}
              onClick={() => setFilter(chip.key)}
              key={chip.key}
            >
              {chip.label}
            </span>
          ))}
        </div>
        <button type="button" className="btn btn--primary" onClick={() => { setError(''); setCreating(true); }}>
          ＋ 新建书稿
        </button>
      </div>

      {creating && (
        <div className="novel-modal__shade" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setCreating(false); }}>
          <form className="novel-modal" onSubmit={createNovel}>
            <div className="novel-modal__head"><div><p className="eyebrow">NEW MANUSCRIPT</p><h2>立一部新书</h2></div><button type="button" className="novel-modal__close" aria-label="关闭" onClick={() => setCreating(false)}>×</button></div>
            <p className="anno">先记录作品的基本方向，细纲与世界规则可以随后由中心 Agent 一起完善。</p>
            <label className="novel-form__field"><span>书名 <i>必填</i></span><input autoFocus value={form.title} onChange={update('title')} placeholder="例如：墨灵" /></label>
            <div className="novel-form__grid">
              <label className="novel-form__field"><span>题材</span><input value={form.genre} onChange={update('genre')} placeholder="玄幻、都市……" /></label>
              <label className="novel-form__field"><span>文风</span><input value={form.style} onChange={update('style')} placeholder="细腻、冷峻……" /></label>
            </div>
            <label className="novel-form__field"><span>一句话故事</span><input value={form.logline} onChange={update('logline')} placeholder="主角是谁，想要什么，阻碍是什么？" /></label>
            <label className="novel-form__field"><span>作品简介</span><textarea rows="3" value={form.description} onChange={update('description')} placeholder="写下目前已有的故事构想……" /></label>
            <div className="novel-form__grid">
              <label className="novel-form__field"><span>目标字数</span><input type="number" min="0" step="1000" value={form.target_words} onChange={update('target_words')} placeholder="例如：300000" /></label>
              <label className="novel-form__field"><span>主题词 <i>逗号分隔</i></span><input value={form.themes} onChange={update('themes')} placeholder="成长，宿命，选择" /></label>
            </div>
            {error && <p className="novel-form__error" role="alert">{error}</p>}
            <div className="novel-modal__actions"><button type="button" className="btn" onClick={() => setCreating(false)}>暂不创建</button><button type="submit" className="btn btn--primary" disabled={saving}>{saving ? '正在落笔…' : '创建书稿'}</button></div>
          </form>
        </div>
      )}

      {!novelsLoaded && <p className="anno">正在取书架……</p>}
      {novelsLoaded && shown.length === 0 && (
        <p className="anno">{novels.length === 0 ? '书架还空着。' : '这个状态下没有书稿。'}</p>
      )}

      <section className="desk__grid">
        {shown.map((book) => {
          const meta = NOVEL_STATUS_META[book.status] || { label: book.status, cls: '' };
          const themes = readThemes(book.themes);
          return (
            <article
              className={`card${novel && novel.id === book.id ? ' is-current' : ''}`}
              onClick={() => setNovelId(book.id)}
              key={book.id}
            >
              <div className="book__head">
                <span className="book__title">《{book.title}》</span>
                <span className={`status ${meta.cls}`}>{meta.label}</span>
              </div>
              <div className="book__meta">
                <span className="chip">{book.genre || '未定题材'}</span>
                <span className="chip">{book.style || '未定文风'}</span>
                <span className="chip">{book.target_words ? `${Math.round(book.target_words / 10000)} 万字` : '未定字数'}</span>
              </div>
              {themes.length > 0 && (
                <div className="chip-row" style={{ marginTop: 6 }}>
                  {themes.map((theme) => (
                    <span className="chip" key={theme}>{theme}</span>
                  ))}
                </div>
              )}
              {(book.logline || book.description) && (
                <div className="field">
                  <p className="field__k" data-en="logline">一句话故事</p>
                  <p className="field__v">{book.logline || book.description}</p>
                </div>
              )}
            </article>
          );
        })}
      </section>
    </main>
  );
}

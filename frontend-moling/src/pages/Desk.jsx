import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import AskModal from '../components/AskModal.jsx';
import BlockTitle from '../components/BlockTitle.jsx';
import Modal from '../components/Modal.jsx';
import { NOVEL_STATUS_META } from '../lib/enums.js';
import { useWorkbench } from '../layout/WorkbenchLayout.jsx';
import { api } from '../api/client.js';

/**
 * 书架：一卡一书，数据来自 `GET /api/novels`（目录库 novels 表）。
 *
 * 卡上取自后端真字段：
 *   标题 title ／ 状态 status ／ 题材 genre + 文风 style ／ 目标字数 target_words
 *   + 主题 themes（JSON 数组）+ 简介 description/logline
 * 另外每张卡补一行**工作流进度**（`GET /api/novels/:id/workflow` 的 phase/label 与任务合计）——
 * 那是"这本书走到哪一步了"的唯一判据，与中心 Agent 的状态快照同源。
 * 拿不到就**不画那一行**（服务没起来时不该显示一个编出来的进度）。
 * 点卡 = 把当前小说切到这本（切完去书稿页看正文）。
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

/**
 * 题材 / 文风的点选器。
 *
 * **为什么不用输入框 + datalist**：datalist 要先点两下才弹列表，站在这一页的人
 * 根本看不出里面有什么可选 —— 而这两项恰恰决定了往后每一章注入哪几段提示词，
 * 藏起来代价太大。所以把可选项直接摆出来（复用顶栏规格行那套按钮样式），
 * 另外留一条"自定义"：作者写「90年代港风」是合法的创作决定，只是没有对应片段。
 */
function FlavorPicker({ label, hint, options, value, onChange, customPlaceholder }) {
  /** 选了不在清单里的名字 = 作者自定的题材/文风 */
  const isCustom = Boolean(value.trim()) && !options.includes(value);
  return (
    <div className="novel-form__field">
      <span>{label} <i>{hint}</i></span>
      {/* 可选项直接摆出来，不藏在下拉里：点一下选中，再点一下取消（空 = 不定） */}
      <div className="spec-picker__options">
        {options.map((item) => (
          <button
            type="button"
            className={value === item ? 'is-selected' : ''}
            onClick={() => onChange(value === item ? '' : item)}
            key={item}
          >
            {item}
          </button>
        ))}
        {/*
          自定义写成内联输入框，不用 window.prompt —— 原生弹窗挡在页面上、看不见其它选项，
          而且与这一页的其它控件不是一路样式。选中清单里的名字时这里留空（两个入口互不干扰）。
        */}
        <input
          type="text"
          className={`flavor-picker__custom${isCustom ? ' is-active' : ''}`}
          value={isCustom ? value : ''}
          onChange={(event) => onChange(event.target.value)}
          placeholder={customPlaceholder ? `或自定，例如 ${customPlaceholder}` : '或自定…'}
          aria-label={`${label}（自定义）`}
        />
      </div>
      {isCustom && (
        <em className="novel-form__note">自定项在片段库里没有同名目录 — 能建能改，只是往后每一章都不会注入这一段。</em>
      )}
    </div>
  );
}

export default function Desk() {
  const { novels, novelsLoaded, novel, setNovelId, setNovels } = useWorkbench();
  const [filter, setFilter] = useState('all');
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ title: '', genre: '', style: '', description: '', logline: '', target_words: '', themes: '' });
  /** bookId → 工作流摘要；取不到的那本不会出现在这里（卡片上就不画进度行） */
  const [progress, setProgress] = useState({});
  /** 可选的文风与类型。后端加一种，这里自动多一项（清单来自磁盘目录，不在前端写死） */
  const [flavors, setFlavors] = useState({ styles: [], genres: [] });
  /**
   * novelId → 后端给的「这个名字没有片段，库里可用的是这些」。
   *
   * **为什么按书存、而不是只放在弹窗里**：建书和改题材文风都是"提交完弹窗就关了"，
   * 放在弹窗里的提示等于没人看得见。落到卡片上，作者下次进来还能看到。
   */
  const [flavorNotice, setFlavorNotice] = useState({});
  /**
   * 正在改题材/文风的那本书（null = 弹窗关着）。
   * 与建书弹窗的状态**分开存** —— 两边各有自己的临时值，混用会互相覆盖。
   */
  const [flavorEdit, setFlavorEdit] = useState(null);
  const [editSaving, setEditSaving] = useState(false);
  /** 待确认移除的那本书（null = 没在问）。单独一组状态：它有自己的错误，不跟别处混 */
  const [pendingRemove, setPendingRemove] = useState(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [removeError, setRemoveError] = useState('');

  useEffect(() => {
    let active = true;
    api.listFlavors()
      .then((result) => { if (active) setFlavors({ styles: result?.styles ?? [], genres: result?.genres ?? [] }); })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  /* 书架一有变动就补一次工作流进度。每本一次请求：书架规模小，换来的是"进度永远与库同步" */
  useEffect(() => {
    if (novels.length === 0) {
      setProgress({});
      return undefined;
    }
    let active = true;
    Promise.all(novels.map((book) => api.workflow(book.id).then((summary) => [book.id, summary]).catch(() => [book.id, null])))
      .then((pairs) => {
        if (!active) return;
        const map = {};
        for (const [bookId, summary] of pairs) if (summary) map[bookId] = summary;
        setProgress(map);
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [novels]);

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
      // 名字对不上任何片段时不拦建书（那可能是作者自定的文风），
      // 但要说一声：没有片段 = 这一章的提示词里不会有那一段，作者会以为选了却没生效。
      // 提示落在**卡片上** —— 弹窗马上就关了，放在弹窗里没人看得见。
      if (created?.flavorHints) setFlavorNotice((current) => ({ ...current, [created.id]: created.flavorHints }));
      setNovelId(created.id);
      setCreating(false);
      setForm({ title: '', genre: '', style: '', description: '', logline: '', target_words: '', themes: '' });
    } catch (cause) { setError(cause.message || '创建失败，请检查服务是否启动。'); }
    finally { setSaving(false); }
  };

  /**
   * 从书架移除一本书。分两步：先摆出确认弹窗，确认了才真发请求。
   *
   * **为什么不用 `window.confirm`**：它在嵌入式预览和各家 WebView 里会被静默吞掉 ——
   * 既不弹框也不执行，还不报错。用户看到的就是"点了删除按钮没反应"。
   * 所以改成本页自己画的弹窗（`components/AskModal.jsx`）。
   *
   * 确认文案必须把话说全：**文件还在，但登记会没**。只说"可以恢复"是不诚实的 ——
   * 恢复要手动把目录搬回去、再重新建一本同 slug 的书，不是点一下就能回来。
   */
  const confirmRemove = async () => {
    if (!pendingRemove) return;
    setRemoveBusy(true);
    setRemoveError('');
    try {
      await api.removeNovel(pendingRemove.id);
      const rest = novels.filter((item) => item.id !== pendingRemove.id);
      setNovels(rest);
      // 删的正好是当前选中那本时，把选择挪到剩下的第一本 ——
      // 否则顶栏的下拉会指向一个已经不存在的 id
      if (novel?.id === pendingRemove.id) setNovelId(rest[0]?.id ?? null);
      setPendingRemove(null);
    } catch (cause) {
      // 失败时**弹窗不关**：把原因摆在原地，不然作者只看到"点了一下、什么也没发生"
      setRemoveError(cause.message || '移除失败，请检查服务是否启动。');
    } finally {
      setRemoveBusy(false);
    }
  };
  /**
   * 打开「改题材与文风」弹窗。带的初值是这本**当前**的值，所以它既是"补一个空着的"，
   * 也是"换一个" —— 同一套动作，不用分两个入口。
   */
  const openFlavorEditor = (book) => {
    setError('');
    setFlavorEdit({ id: book.id, title: book.title, genre: book.genre || '', style: book.style || '' });
  };

  /**
   * 保存题材与文风。
   *
   * 与建书同一个口径：拼错目录名**不拦**（作者自定题材是合法的创作决定），
   * 但把"你是不是想写这个"带回来，落在卡片上再说一次。
   */
  const saveFlavorEdit = async (event) => {
    event.preventDefault();
    setEditSaving(true);
    setError('');
    try {
      const updated = await api.updateNovelFlavors(flavorEdit.id, { genre: flavorEdit.genre.trim(), style: flavorEdit.style.trim() });
      setNovels((current) => current.map((item) => (item.id === updated.id ? { ...item, ...updated } : item)));
      if (updated?.flavorHints) setFlavorNotice((current) => ({ ...current, [updated.id]: updated.flavorHints }));
      setFlavorEdit(null);
    } catch (cause) { setError(cause.message || '改不动，请检查服务是否启动。'); }
    finally { setEditSaving(false); }
  };

  /**
   * 这个题材/文风在清单里吗？不在 = 没有对应片段，这一章的提示词里不会有那一段。
   *
   * **为什么要在书架上标出来**：拼错的后果是沉默的 —— 书照写，章节照出，
   * 只是每章都读着"有点不对"，而没有任何地方会报错。建书弹窗里提示过一次就关了，
   * 作者多半不会记得。书架是他每次进来都会看到的地方，所以要在这里再说一次。
   *
   * 清单取不到（后端没起）时一律当作"有"：不因为接口失败而给每本书挂一个假警告。
   */
  const flavorKnown = (name, list) => {
    const value = (name ?? '').trim();
    if (!value || list.length === 0) return true;
    return list.includes(value);
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
        <Modal onSubmit={createNovel} onBackdrop={() => setCreating(false)} onEscape={() => setCreating(false)}>
          <div className="novel-modal__head"><div><p className="eyebrow">NEW MANUSCRIPT</p><h2>立一部新书</h2></div><button type="button" className="novel-modal__close" aria-label="关闭" onClick={() => setCreating(false)}>×</button></div>
          <p className="anno">先记录作品的基本方向，细纲与世界规则可以随后由中心 Agent 一起完善。</p>
          <label className="novel-form__field"><span>书名 <i>必填</i></span><input autoFocus value={form.title} onChange={update('title')} placeholder="例如：墨灵" /></label>
          {/* 各占一整行，不挤在 1fr 1fr 里 —— 8 个题材挤半栏要折成四行按钮，反而更难扫 */}
          <FlavorPicker
            label="题材"
            hint="规则 · 专名约束 · 常见失误"
            options={flavors.genres}
            value={form.genre}
            onChange={(next) => setForm((current) => ({ ...current, genre: next }))}
            customPlaceholder="90年代港风"
          />
          <FlavorPicker
            label="文风"
            hint="句式 · 叙述距离 · 节奏"
            options={flavors.styles}
            value={form.style}
            onChange={(next) => setForm((current) => ({ ...current, style: next }))}
            customPlaceholder="清冷的"
          />
          <p className="novel-form__note" style={{ marginTop: 4 }}>
            选项来自侧栏的<Link to="/w/flavors">「题材文风」</Link>库，那里还能上传图片或文档，让模型生成新的题材与文风。
          </p>
          <label className="novel-form__field"><span>一句话故事</span><input value={form.logline} onChange={update('logline')} placeholder="主角是谁，想要什么，阻碍是什么？" /></label>
          <label className="novel-form__field"><span>作品简介</span><textarea rows="3" value={form.description} onChange={update('description')} placeholder="写下目前已有的故事构想……" /></label>
          <div className="novel-form__grid">
            <label className="novel-form__field"><span>目标字数</span><input type="number" min="0" step="1000" value={form.target_words} onChange={update('target_words')} placeholder="例如：300000" /></label>
            <label className="novel-form__field"><span>主题词 <i>逗号分隔</i></span><input value={form.themes} onChange={update('themes')} placeholder="成长，宿命，选择" /></label>
          </div>
          {error && <p className="novel-form__error" role="alert">{error}</p>}
          <div className="novel-modal__actions"><button type="button" className="btn" onClick={() => setCreating(false)}>暂不创建</button><button type="submit" className="btn btn--primary" disabled={saving}>{saving ? '正在落笔…' : '创建书稿'}</button></div>
        </Modal>
      )}

      {/* 改题材与文风。复用建书那一套字段与样式 —— 同一件事在两眼看到的样子应该一样 */}
      {flavorEdit && (
        <Modal
          slim
          onSubmit={saveFlavorEdit}
          onBackdrop={() => { setFlavorEdit(null); setError(''); }}
          onEscape={() => { setFlavorEdit(null); setError(''); }}
        >
          <div className="novel-modal__head">
            <div><p className="eyebrow">FLAVOR</p><h2>《{flavorEdit.title}》的题材与文风</h2></div>
            <button type="button" className="novel-modal__close" aria-label="关闭" onClick={() => { setFlavorEdit(null); setError(''); }}>×</button>
          </div>
          <FlavorPicker
            label="题材"
            hint="规则 · 专名约束 · 常见失误"
            options={flavors.genres}
            value={flavorEdit.genre}
            onChange={(next) => setFlavorEdit((current) => ({ ...current, genre: next }))}
            customPlaceholder="90年代港风"
          />
          <FlavorPicker
            label="文风"
            hint="句式 · 叙述距离 · 节奏"
            options={flavors.styles}
            value={flavorEdit.style}
            onChange={(next) => setFlavorEdit((current) => ({ ...current, style: next }))}
            customPlaceholder="清冷的"
          />
          {/*
            这句必须写：改的是**往后**注入哪几段提示词，不是把已经写完的稿子按新文风重写。
            不说清楚，作者改完一看旧章节没变，会以为这个功能没生效。
          */}
          <p className="novel-form__note" style={{ marginTop: 4 }}>
            只影响往后生成的章节 —— 片段是生成那一刻注入的，已经写好的正文不会被改写。
          </p>
          {error && <p className="novel-form__error" role="alert">{error}</p>}
          <div className="novel-modal__actions">
            <button type="button" className="btn" onClick={() => { setFlavorEdit(null); setError(''); }}>取消</button>
            <button type="submit" className="btn btn--primary" disabled={editSaving}>{editSaving ? '正在改…' : '保存'}</button>
          </div>
        </Modal>
      )}

      {/* 移除确认。文案把"能捞回来但要多两步"说全 —— 只说"可以恢复"是不诚实的 */}
      {pendingRemove && (
        <AskModal
          eyebrow="REMOVE"
          title={`从书架移除《${pendingRemove.title}》？`}
          note={
            <>
              书稿文件不会被真删，会挪进项目里的 <code>.workbuddy/novel-trash/</code>。
              <br />
              但目录里的登记会删掉 —— 要恢复得把目录搬回去，再重新建一本同 slug 的书。
            </>
          }
          confirmLabel="移除"
          danger
          busy={removeBusy}
          error={removeError}
          onCancel={() => { setPendingRemove(null); setRemoveError(''); }}
          onConfirm={confirmRemove}
        />
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
                <span className="book__right">
                  <span className={`status ${meta.cls}`}>{meta.label}</span>
                  <button
                    type="button"
                    className="book__remove"
                    title="从书架移除"
                    aria-label={`从书架移除《${book.title}》`}
                    // 卡片本身点一下是"切到这本"，所以移除必须拦掉冒泡，否则会顺手把它选中
                    onClick={(event) => { event.stopPropagation(); setRemoveError(''); setPendingRemove(book); }}
                  >
                    ×
                  </button>
                </span>
              </div>
              {/*
                题材 / 文风做成按钮：这两项决定往后每一章注入哪几段提示词，
                点一下就能改（补一个空的、或换一个）。空着的写成「＋ 定题材」，
                是给"当初没填"的人一个看得见的入口 —— 不然他永远找不到在哪设。
              */}
              <div className="book__meta">
                <button
                  type="button"
                  className={`chip chip--edit${book.genre ? (flavorKnown(book.genre, flavors.genres) ? '' : ' chip--off') : ' is-blank'}`}
                  title="点一下改题材与文风"
                  onClick={(event) => { event.stopPropagation(); openFlavorEditor(book); }}
                >
                  {book.genre || '＋ 定题材'}
                  {book.genre && !flavorKnown(book.genre, flavors.genres) ? ' ·无片段' : ''}
                </button>
                <button
                  type="button"
                  className={`chip chip--edit${book.style ? (flavorKnown(book.style, flavors.styles) ? '' : ' chip--off') : ' is-blank'}`}
                  title="点一下改题材与文风"
                  onClick={(event) => { event.stopPropagation(); openFlavorEditor(book); }}
                >
                  {book.style || '＋ 定文风'}
                  {book.style && !flavorKnown(book.style, flavors.styles) ? ' ·无片段' : ''}
                </button>
                <span className="chip">{book.target_words ? `${Math.round(book.target_words / 10000)} 万字` : '未定字数'}</span>
              </div>
              {/* 后端说"这个名字库里没有"时，把那几个能用的名字直接摆出来（拼错的人立刻知道改什么） */}
              {(flavorNotice[book.id]?.genre || flavorNotice[book.id]?.style) && (
                <p className="book__notice">
                  没有对应片段，不会被注入：
                  {flavorNotice[book.id]?.genre && <> 题材可填 {flavorNotice[book.id].genre.join('、')}</>}
                  {flavorNotice[book.id]?.genre && flavorNotice[book.id]?.style ? '；' : ''}
                  {flavorNotice[book.id]?.style && <> 文风可填 {flavorNotice[book.id].style.join('、')}</>}
                  （自定的名字也能用，只是没有片段）
                </p>
              )}
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
              {progress[book.id] && (
                <div className="field">
                  <p className="field__k" data-en="phase">进度</p>
                  <p className="field__v">
                    {progress[book.id].label}
                    {progress[book.id].total > 0 ? ` · 任务 ${progress[book.id].done}/${progress[book.id].total}` : ''}
                    {progress[book.id].running > 0 ? ` · ${progress[book.id].running} 在写` : ''}
                    {progress[book.id].failed > 0 ? ` · ${progress[book.id].failed} 折笔` : ''}
                  </p>
                </div>
              )}
            </article>
          );
        })}
      </section>
    </main>
  );
}

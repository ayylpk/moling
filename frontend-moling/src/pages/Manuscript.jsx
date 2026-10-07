import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import BlockTitle from '../components/BlockTitle.jsx';
import { useWorkbench } from '../layout/WorkbenchLayout.jsx';
import { api } from '../api/client.js';

/**
 * 书稿：卷目录 + 正文编辑。
 *
 * 数据来自当前基座（agent/storage/server.ts）的三条接口：
 *   GET /api/novels/:id/volumes         —— 卷表（卷号 / 卷名 / 起止章）
 *   GET /api/novels/:id/chapters        —— 章表（含 volume_id / 章纲五字段 / textStage）
 *   GET / PUT /api/chapters/:id/text    —— 某一阶段正文
 *
 * 卷**以卷表为准**（卷名与卷号是真的），章按 volume_id 挂到卷下；
 * 万一卷表还没建（只落了章纲），退回按 volume_id 现推、卷号只能用序号。
 *
 * 保存三层兜底：确认按钮即时存 → 改动后 10 秒自动存 → 离开页面前再存一次；
 * 每次落盘前先写 localStorage，API 不通时至少不丢字。
 */

const STAGE_META = {
  final: { zh: '终稿', toc: '终', cls: 'done' },
  draft: { zh: '初稿', toc: '初', cls: 'writing' },
  none: { zh: '仅有章纲', toc: '纲', cls: 'draft' },
};

export default function Manuscript() {
  const { novel, setSaving } = useWorkbench();
  const [chapters, setChapters] = useState([]);
  const [volumeRows, setVolumeRows] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [volumeId, setVolumeId] = useState(null);
  const [chapterId, setChapterId] = useState(null);
  const [text, setText] = useState('');
  const [dirty, setDirty] = useState(false);
  const [lastSaved, setLastSaved] = useState('尚未改动');
  /** 导出多选。空集合 = 没选，这时工具栏只提供"导出本章" */
  const [picked, setPicked] = useState(() => new Set());
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState('');

  /* 卷：以卷表为准（卷名/卷号是真的），章按 volume_id 挂上去 */
  const volumes = useMemo(() => {
    const byVolume = new Map();
    for (const chapter of chapters) {
      const key = chapter.volume_id ?? 0;
      if (!byVolume.has(key)) byVolume.set(key, []);
      byVolume.get(key).push(chapter);
    }
    if (volumeRows.length > 0) {
      return volumeRows.map((row) => ({ id: row.id, no: row.no, name: row.name, chapters: byVolume.get(row.id) ?? [] }));
    }
    // 卷表还没建（只落了章纲）：退回按 volume_id 现推，卷号只能用序号
    return [...byVolume.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([key, list], index) => ({ id: key, no: index + 1, name: '', chapters: list }));
  }, [chapters, volumeRows]);

  const volume = volumes.find((item) => item.id === volumeId) || volumes[0] || null;
  const chapter = volume?.chapters.find((item) => item.id === chapterId) || volume?.chapters[0] || null;

  /* 换书 → 重取卷表与章节表 */
  useEffect(() => {
    if (!novel?.id) {
      setChapters([]);
      setVolumeRows([]);
      setLoaded(true);
      return undefined;
    }
    let active = true;
    setLoaded(false);
    Promise.all([
      api.listChapters(novel.id).catch(() => []),
      api.listVolumes(novel.id).catch(() => []),
    ])
      .then(([items, rows]) => {
        if (!active) return;
        const chapterList = Array.isArray(items) ? items : [];
        setChapters(chapterList);
        setVolumeRows(Array.isArray(rows) ? rows : []);
        setVolumeId(chapterList[0]?.volume_id ?? null);
        setChapterId(chapterList[0]?.id ?? null);
      })
      .finally(() => { if (active) setLoaded(true); });
    return () => { active = false; };
  }, [novel?.id]);

  /* 换章 → 先读本地草稿垫底，再用服务端正文覆盖 */
  useEffect(() => {
    if (!chapter?.id) {
      setText('');
      setDirty(false);
      return undefined;
    }
    const cached = window.localStorage.getItem(`moling:${novel.id}:chapter:${chapter.id}:draft`);
    setText(cached ? JSON.parse(cached).text : '');
    setDirty(false);
    let cancelled = false;
    api.getChapterText(novel.id, chapter.id)
      .then((result) => {
        if (!cancelled && typeof result?.text === 'string' && result.text) setText(result.text);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [novel?.id, chapter?.id]);

  const saveText = useCallback((reason = 'manual') => {
    if (!chapter?.id || !dirty) return;
    window.localStorage.setItem(
      `moling:${novel.id}:chapter:${chapter.id}:draft`,
      JSON.stringify({ text, savedAt: new Date().toISOString() }),
    );
    setSaving('saving');
    api.saveChapterText(novel.id, chapter.id, text)
      .then(() => {
        setDirty(false);
        setLastSaved(reason === 'auto' ? '自动保存 · 刚刚' : '已保存 · 刚刚');
        setSaving('saved');
      })
      .catch(() => {
        setLastSaved('本地草稿已保存 · 服务端待命');
        setSaving('saved');
      });
  }, [novel?.id, chapter?.id, dirty, text, setSaving]);

  /* 停笔 10 秒自动存 */
  const saveRef = useRef(saveText);
  saveRef.current = saveText;
  useEffect(() => {
    if (!dirty) return undefined;
    const timer = window.setTimeout(() => saveRef.current('auto'), 10000);
    return () => window.clearTimeout(timer);
  }, [dirty, text]);

  /* 离开页面前补一刀 */
  useEffect(() => {
    const flush = () => { if (dirty) saveRef.current('close'); };
    window.addEventListener('beforeunload', flush);
    return () => {
      window.removeEventListener('beforeunload', flush);
      flush();
    };
  }, [dirty]);

  const selectChapter = (nextId) => {
    if (dirty) saveText();
    setChapterId(nextId);
  };

  /* ---------- 导出 ---------- */

  /* 换书就清空选择：上一本选中的 id 在这一本里指向别的章，留着会导出错的章 */
  useEffect(() => { setPicked(new Set()); setNotice(''); }, [novel?.id]);

  const togglePick = (id) =>
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  /* 全选只作用于**当前这一卷**：逐章点一百次不叫批量导出，而跨卷全选容易误伤 */
  const volumeChapterIds = (volume?.chapters ?? []).map((item) => item.id);
  const allPickedInVolume = volumeChapterIds.length > 0 && volumeChapterIds.every((id) => picked.has(id));
  const toggleAllInVolume = () =>
    setPicked((current) => {
      const next = new Set(current);
      if (allPickedInVolume) for (const id of volumeChapterIds) next.delete(id);
      else for (const id of volumeChapterIds) next.add(id);
      return next;
    });

  /**
   * 单章与批量走的是同一个接口，区别只是 ids 里有几个。
   *
   * 用 fetch 取回 Blob 再由前端触发下载，而不是挂一个指向导出地址的链接 ——
   * 因为导出失败时后端回的是 JSON，直接导航过去只会把一段错误 JSON 存成 .txt。
   */
  const runExport = async (ids) => {
    if (ids.length === 0 || exporting) return;
    if (dirty) saveText();
    setExporting(true);
    setNotice('');
    try {
      const { blob, filename } = await api.exportChapters(novel.id, ids);
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);
      setNotice(`已导出 ${ids.length} 章：${filename}`);
    } catch (cause) {
      setNotice(cause.message || '导出失败');
    } finally {
      setExporting(false);
    }
  };

  if (!novel) {
    return (
      <main className="wb-page manuscript-page enter" style={{ maxWidth: 'none' }}>
        <BlockTitle mark="稿" name="书稿" />
        <p className="anno">{loaded ? '书架上还没有书稿。' : '正在取书稿……'}</p>
      </main>
    );
  }

  const stage = STAGE_META[chapter?.textStage] || STAGE_META.none;

  return (
    <main className="wb-page manuscript-page enter" style={{ maxWidth: 'none' }}>
      <BlockTitle mark="稿" name="书稿" />
      <div className="manuscript__toolbar">
        <div className="volume-tabs">
          {volumes.map((item) => (
            <button
              className={item.id === volume?.id ? 'is-active' : ''}
              type="button"
              onClick={() => {
                if (dirty) saveText();
                setVolumeId(item.id);
                setChapterId(item.chapters[0]?.id ?? null);
              }}
              key={item.id}
            >
              第 {item.no} 卷{item.name ? ` · ${item.name}` : ''} · {item.chapters.length} 章
            </button>
          ))}
        </div>
        <div className="manuscript__save">
          <span className="anno">{notice || lastSaved}</span>
          <button
            type="button"
            className="btn btn--sm"
            disabled={!chapter || exporting}
            onClick={() => runExport([chapter.id])}
          >
            导出本章
          </button>
          {picked.size > 0 && (
            <button type="button" className="btn btn--sm" disabled={exporting} onClick={() => runExport([...picked])}>
              {exporting ? '导出中…' : `导出选中 ${picked.size} 章`}
            </button>
          )}
          <button type="button" className="btn btn--primary" disabled={!dirty} onClick={() => saveText()}>
            确认保存
          </button>
        </div>
      </div>

      {!loaded && <p className="anno">正在取章节……</p>}
      {loaded && chapters.length === 0 && <p className="anno">这本书还没有章节。</p>}

      {chapters.length > 0 && (
        <div className="ms-editor">
          <nav className="ms-editor__toc">
            <p className="eyebrow">全书 {chapters.length} 章</p>
            <h3>{`《${novel.title}》`}</h3>
            {/* checkbox 不能放进 button 里，所以目录行改成「多选框 + 章条目」的组合 */}
            <div className="toc-tools">
              <span className="chip" onClick={toggleAllInVolume}>
                {allPickedInVolume ? '取消全选本卷' : '全选本卷'}
              </span>
              {picked.size > 0 && <span className="chip" onClick={() => setPicked(new Set())}>清空已选</span>}
            </div>
            {volume?.chapters.map((item) => (
              <div className="toc-row" key={item.id}>
                <input
                  type="checkbox"
                  checked={picked.has(item.id)}
                  onChange={() => togglePick(item.id)}
                  aria-label={`选择第 ${item.idx} 章用于导出`}
                />
                <button
                  className={`toc-item${item.id === chapter?.id ? ' is-active' : ''}`}
                  type="button"
                  onClick={() => selectChapter(item.id)}
                >
                  <span className="toc-num">{String(item.idx).padStart(2, '0')}</span>
                  <span className="toc-name">{item.title}</span>
                  <span className={`toc-status is-${item.textStage === 'final' ? 'final' : item.textStage === 'draft' ? 'draft' : 'outlined'}`}>
                    {(STAGE_META[item.textStage] || STAGE_META.none).toc}
                  </span>
                </button>
              </div>
            ))}
          </nav>

          <article className="ms-editor__paper">
            {chapter ? (
              <>
                <div className="ms-editor__heading">
                  <p className="eyebrow">第 {chapter.idx} 章</p>
                  <h2>{chapter.title}</h2>
                  <span className={`status is-${stage.cls}`}>{stage.zh}</span>
                </div>
                <textarea
                  className="manuscript-input"
                  value={text}
                  onChange={(event) => {
                    setText(event.target.value);
                    setDirty(true);
                    setSaving('dirty');
                  }}
                  placeholder="从这里开始写本章正文……"
                  spellCheck="false"
                />
                <p className="manuscript__count">
                  {text.length.toLocaleString()} 字 · {dirty ? '修改尚未落盘' : '内容已保存'}
                </p>
              </>
            ) : (
              <div className="empty">
                <p className="empty__title">选择一章开始阅读</p>
                <p className="anno">章节正文会在打开后启用定时保存。</p>
              </div>
            )}
          </article>

          <aside className="ms-editor__note">
            {chapter ? (
              <>
                <div className="note-card__head">
                  <span>章节浮签</span>
                  <span className="anno">chapter · {chapter.idx}</span>
                </div>
                {chapter.goal && <div className="field"><p className="field__k">本章目标</p><p className="field__v">{chapter.goal}</p></div>}
                <div className="field"><p className="field__k">结尾钩子</p><p className="field__v">{chapter.hook || '—'}</p></div>
                <div className="field"><p className="field__k">情绪落点</p><p className="field__v">{chapter.emotion || '—'}</p></div>
                <div className="field">
                  <p className="field__k">保存规则</p>
                  <p className="field__v anno">确认按钮即时保存；修改后 10 秒自动保存；离开页面前再保存一次。</p>
                </div>
              </>
            ) : (
              <p className="anno">暂无章节信息</p>
            )}
          </aside>
        </div>
      )}
    </main>
  );
}

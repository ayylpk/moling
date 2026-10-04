import { useEffect, useMemo, useState } from 'react';
import BlockTitle from '../components/BlockTitle.jsx';
import { VOLUMES } from '../lib/workbenchData.js';
import { useWorkbench } from '../layout/WorkbenchLayout.jsx';
import { api } from '../api/client.js';

export default function Manuscript() {
  const { setSaving } = useWorkbench();
  const [volumeId, setVolumeId] = useState(VOLUMES[0].id);
  const volume = VOLUMES.find((item) => item.id === volumeId) || VOLUMES[0];
  const [chapterId, setChapterId] = useState(volume.chapters[0]?.id || null);
  const chapter = useMemo(() => volume.chapters.find((item) => item.id === chapterId) || volume.chapters[0], [volume, chapterId]);
  const [text, setText] = useState(chapter?.text || '');
  const [dirty, setDirty] = useState(false);
  const [lastSaved, setLastSaved] = useState('刚刚');

  useEffect(() => {
    const next = volume.chapters[0];
    setChapterId(next?.id || null);
    setText(next?.text || '');
    setDirty(false);
  }, [volumeId]);

  useEffect(() => {
    if (!chapter) return undefined;
    const cached = window.localStorage.getItem(`moling:chapter:${chapter.id}:draft`);
    setText(cached ? JSON.parse(cached).text : (chapter.text || ''));
    setDirty(false);
    let cancelled = false;
    api.getChapterText(chapter.id).then((result) => {
      if (!cancelled && result?.text) setText(result.text);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [chapterId]);

  useEffect(() => {
    if (!dirty) return undefined;
    const timer = window.setTimeout(() => saveText('auto'), 10000);
    return () => window.clearTimeout(timer);
  }, [dirty, text]);

  useEffect(() => {
    const flush = () => {
      if (dirty) saveText('close');
    };
    window.addEventListener('beforeunload', flush);
    return () => {
      window.removeEventListener('beforeunload', flush);
      flush();
    };
  }, [dirty, text]);

  const saveText = (reason = 'manual') => {
    if (!chapter || !dirty) return;
    window.localStorage.setItem(`moling:chapter:${chapter.id}:draft`, JSON.stringify({ text, savedAt: new Date().toISOString() }));
    setSaving('saving');
    api.saveChapterText(chapter.id, text).then(() => {
      setDirty(false);
      setLastSaved(reason === 'auto' ? '自动保存 · 刚刚' : '已保存 · 刚刚');
      setSaving('saved');
    }).catch(() => {
      setLastSaved('本地草稿已保存 · API 待命');
      setSaving('saved');
    });
  };

  const selectChapter = (nextId) => {
    if (dirty) saveText();
    setChapterId(nextId);
  };

  return (
    <main className="wb-page manuscript-page enter" style={{ maxWidth: 'none' }}>
      <BlockTitle mark="稿" name="书稿" />
      <div className="manuscript__toolbar"><div className="volume-tabs">{VOLUMES.map((item) => <button className={item.id === volumeId ? 'is-active' : ''} type="button" onClick={() => setVolumeId(item.id)} key={item.id}>卷 {item.no} · {item.name}</button>)}</div><div className="manuscript__save"><span className="anno">{lastSaved}</span><button type="button" className="btn btn--primary" disabled={!dirty} onClick={() => saveText()}>确认保存</button></div></div>
      <div className="ms-editor">
        <nav className="ms-editor__toc"><p className="eyebrow">卷 {volume.no} · {volume.chapters.length} 章</p><h3>{volume.name}</h3>{volume.chapters.map((item) => <button className={`toc-item${item.id === chapter?.id ? ' is-active' : ''}`} type="button" onClick={() => selectChapter(item.id)} key={item.id}><span className="toc-num">{String(item.idx).padStart(2, '0')}</span><span className="toc-name">{item.title}</span><span className={`toc-status is-${item.status}`}>{item.status === 'final' ? '终' : item.status === 'draft' ? '初' : '纲'}</span></button>)}{volume.chapters.length === 0 && <p className="anno">这一卷还没有章节。</p>}</nav>
        <article className="ms-editor__paper">{chapter ? <><div className="ms-editor__heading"><p className="eyebrow">第 {chapter.idx} 章</p><h2>{chapter.title}</h2><span className={`status is-${chapter.status === 'final' ? 'done' : chapter.status === 'draft' ? 'writing' : 'draft'}`}>{chapter.status === 'final' ? '终稿' : chapter.status === 'draft' ? '初稿' : '仅有章纲'}</span></div><textarea className="manuscript-input" value={text} onChange={(event) => { setText(event.target.value); setDirty(true); setSaving('dirty'); }} placeholder="从这里开始写本章正文……" spellCheck="false" /><p className="manuscript__count">{text.length.toLocaleString()} 字 · {dirty ? '修改尚未落盘' : '内容已保存'}</p></> : <div className="empty"><p className="empty__title">选择一章开始阅读</p><p className="anno">章节正文会在打开后启用定时保存。</p></div>}</article>
        <aside className="ms-editor__note">{chapter ? <><div className="note-card__head"><span>章节浮签</span><span className="anno">chapter · {chapter.idx}</span></div><div className="field"><p className="field__k">结尾钩子</p><p className="field__v">{chapter.hook}</p></div><div className="field"><p className="field__k">情绪落点</p><p className="field__v">{chapter.emotion}</p></div><div className="field"><p className="field__k">保存规则</p><p className="field__v anno">确认按钮即时保存；修改后 10 秒自动保存；离开页面前再保存一次。</p></div></> : <p className="anno">暂无章节信息</p>}</aside>
      </div>
    </main>
  );
}

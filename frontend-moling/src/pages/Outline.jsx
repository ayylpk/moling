import { useEffect, useMemo, useState } from 'react';
import BlockTitle from '../components/BlockTitle.jsx';
import { useWorkbench } from '../layout/WorkbenchLayout.jsx';
import { api } from '../api/client.js';

/**
 * 大纲页：逐卷的三幕结构 / 张力曲线 / 硬约束 + 草案审核区。
 *
 * 数据来自三条接口：
 *   GET /api/novels/:id/volumes  —— 卷表（卷名 / 卷目标 / 起止章 / hasOutline）
 *   GET /api/novels/:id/outline  —— 锚点 + 每卷的卷纲本体（acts / pacing / constraints）
 *   GET /api/novels/:id/drafts?stage=volume_outline —— 待审核的卷纲草案
 * 前两条按 volumeId 对齐。**卷表有几卷就列几卷**，没写卷纲的那一卷如实标出来，
 * 不拿别的卷的内容顶上（之前这一页摆的是另一本书的三幕与张力值）。
 *
 * ── 草案动线（10/8）──
 * 一次 generate 只排一段（range 写明，如第 1–10 章），草案落 drafts 表等审核；
 * 采纳 = save_volume_outline + save_chapter_outline 一起落库（后端编排），然后停。
 * 前置：世界观必须已落库（没有就禁用按钮并提示）。
 */

const asArray = (value) => (Array.isArray(value) ? value : []);
const asObject = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});

export default function Outline() {
  const { novel } = useWorkbench();
  const [volumes, setVolumes] = useState([]);
  const [outlineByVolume, setOutlineByVolume] = useState({});
  const [hasWorld, setHasWorld] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');

  /* ---------- 草案状态 ---------- */
  const [draft, setDraft] = useState(null);
  const [range, setRange] = useState('第 1–10 章');
  const [need, setNeed] = useState('');
  const [volumeNo, setVolumeNo] = useState(1);
  const [generating, setGenerating] = useState(false);
  const [acting, setActing] = useState('');
  const [draftError, setDraftError] = useState('');

  const reload = (novelId, active) => {
    return Promise.all([
      api.listVolumes(novelId).catch(() => []),
      api.getOutline(novelId),
      api.listWorlds(novelId).catch(() => []),
      api.listDrafts(novelId, 'volume_outline').catch(() => []),
    ]).then(([volumeRows, outline, worlds, drafts]) => {
      if (!active) return;
      setVolumes(asArray(volumeRows));
      const map = {};
      for (const item of asArray(outline?.volumeOutlines)) map[item.volumeId] = item;
      setOutlineByVolume(map);
      setHasWorld(asArray(worlds).length > 0);
      setDraft(asArray(drafts)[0] ?? null);
    });
  };

  useEffect(() => {
    if (!novel?.id) {
      setVolumes([]); setOutlineByVolume({}); setHasWorld(false); setDraft(null);
      setLoaded(true); setError('');
      return undefined;
    }
    let active = true;
    setLoaded(false); setError('');
    reload(novel.id, active)
      .catch((cause) => { if (active) { setVolumes([]); setOutlineByVolume({}); setError(cause.message || '读不到大纲'); } })
      .finally(() => { if (active) setLoaded(true); });
    return () => { active = false; };
  }, [novel?.id]);

  /** 下一段的默认起点：全书已有章纲的最大章号 + 1（章纲 idx 全篇连续唯一，按 idx 排就是全书顺序） */
  const nextStart = useMemo(() => {
    const maxIdx = volumes.reduce((max, volume) => Math.max(max, volume.endChapter ?? 0), 0);
    return maxIdx + 1;
  }, [volumes]);

  const generateDraft = async (nextSegment = false) => {
    if (!novel?.id || generating) return;
    setGenerating(true); setDraftError('');
    const nextRange = nextSegment ? `第 ${nextStart}–${nextStart + 9} 章` : range;
    if (nextSegment) setRange(nextRange);
    try {
      const created = await api.generateVolumeOutlineDraft(novel.id, {
        range: nextRange.trim(),
        need: need.trim() || '本卷要交付什么：按当前世界观与已有角色推进主线。',
        volumeNo: Number(volumeNo) || 1,
      });
      setDraft(created);
    } catch (cause) { setDraftError(cause.message || '卷纲草案生成失败。'); } finally { setGenerating(false); }
  };
  const adoptDraft = async () => {
    if (!novel?.id || !draft) return;
    setActing('adopt'); setDraftError('');
    try {
      await api.adoptDraft(novel.id, 'volume_outline', draft.targetKey);
      await reload(novel.id, true);
      setDraft(null);
      setVolumeNo((current) => current + 1);
      setRange(`第 ${nextStart}–${nextStart + 9} 章`);
    } catch (cause) { setDraftError(cause.message || '采纳失败。'); } finally { setActing(''); }
  };
  const discardDraft = async () => {
    if (!novel?.id || !draft) return;
    setActing('discard'); setDraftError('');
    try {
      await api.discardDraft(novel.id, 'volume_outline', draft.targetKey);
      setDraft(null);
    } catch (cause) { setDraftError(cause.message || '放弃失败。'); } finally { setActing(''); }
  };

  if (!novel) {
    return (
      <main className="wb-page enter">
        <BlockTitle mark="纲" name="大纲" />
        <p className="anno">{loaded ? '书架上还没有书稿。' : '正在读取……'}</p>
      </main>
    );
  }

  const draftContent = draft?.parsed ?? null;
  const draftChapters = asArray(draftContent?.chapters);
  const draftActs = asArray(draftContent?.structure?.acts);

  return (
    <main className="wb-page enter">
      <BlockTitle mark="纲" name="大纲" />

      {error && <p className="anno">{error}</p>}
      {!loaded && !error && <p className="anno">正在取卷纲……</p>}

      {loaded && volumes.length === 0 && (
        <div className="card">
          <p className="anno">
            《{novel.title}》还没有卷。第一卷落库时，会同时写进：三幕结构（acts）、
            张力曲线（pacing）、硬约束（constraints），以及这一卷的全篇锚点快照 ——
            之后拿它和当前锚点逐字比对，对不上就是漂移。
          </p>
        </div>
      )}

      {/* 草案审核区：一次只排一段，采纳才落库 */}
      {loaded && (
        <section className="block">
          <BlockTitle mark="排" name="排一段卷纲草案" />
          <div className="card" style={{ padding: '12px 22px 16px' }}>
            {!hasWorld && (
              <p className="anno">这本书还没有世界观 —— 排卷纲以世界观为硬约束。先到「世界观」页生成并采纳一份草案。</p>
            )}
            <div className="novel-form__grid" style={{ gridTemplateColumns: '140px 1fr', gap: 10 }}>
              <label className="novel-form__field"><span>章号段 <i>必填</i></span><input value={range} onChange={(event) => setRange(event.target.value)} placeholder="第 1–10 章" disabled={!hasWorld || generating} /></label>
              <label className="novel-form__field"><span>卷号 <i>第几卷</i></span><input type="number" min="1" value={volumeNo} onChange={(event) => setVolumeNo(event.target.value)} disabled={!hasWorld || generating} /></label>
            </div>
            <label className="novel-form__field"><span>这一段要交付什么</span><textarea rows="2" value={need} onChange={(event) => setNeed(event.target.value)} placeholder="本卷/本段的戏剧任务、必须发生的转折、要埋或要收的伏笔。" disabled={!hasWorld || generating} /></label>
            <div style={{ display: 'flex', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
              <button type="button" className="btn btn--primary btn--sm" disabled={!hasWorld || generating} onClick={() => generateDraft(false)} title={hasWorld ? '生成后先给你审核，不会直接落库' : '先去世界观页采纳一份草案'}>{generating ? '正在生成…' : '生成卷纲草案'}</button>
              <button type="button" className="btn btn--sm" disabled={!hasWorld || generating} onClick={() => generateDraft(true)} title={`默认从第 ${nextStart} 章接着排`}>生成下一段章纲（第 {nextStart} 章起）</button>
              {draft && <button type="button" className="btn btn--sm" disabled={generating || acting !== ''} onClick={() => generateDraft(false)}>重新生成</button>}
            </div>
            {generating && <p className="anno" style={{ marginTop: 8 }}>正在排「{range}」的草案……一次只排一段，生成完会停下来等你审核。</p>}
            {draftError && <p className="novel-form__error">{draftError}</p>}
          </div>

          {draft && (
            <div className="card">
              <div className="book__head">
                <span className="book__title">卷纲草案 · {draftContent?.volume?.name || '第 ? 卷'}（{draftContent?.volume?.start_chapter}–{draftContent?.volume?.end_chapter} 章）</span>
                <span className="status is-writing">草案 · 未落库 · {draft.updatedAt || ''}</span>
              </div>
              <div className="field">
                <p className="field__k" data-en="logline">一句话故事</p>
                <p className="field__v field__v--prose">{draftContent?.direction?.logline || '—'}</p>
              </div>
              {draftActs.length > 0 && (
                <div className="field">
                  <p className="field__k">幕</p>
                  <div className="chip-row" style={{ flexWrap: 'wrap', gap: 8 }}>
                    {draftActs.map((act, index) => (
                      <span className="chip" key={act?.id ?? index} title={act?.summary || ''}>
                        {act?.name || `第 ${index + 1} 幕`}
                        {act?.startChapter !== undefined ? `（${act.startChapter}–${act.endChapter} 章）` : ''}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {draftChapters.length > 0 && (
                <div className="field">
                  <p className="field__k">章纲（{draftChapters.length} 章）</p>
                  {draftChapters.map((chapter) => (
                    <p className="field__v anno" key={chapter?.index} style={{ marginTop: 4 }}>
                      第 {chapter?.index} 章《{chapter?.title}》—— {chapter?.goal || '—'}{chapter?.hook ? `｜钩子：${chapter.hook}` : ''}
                    </p>
                  ))}
                </div>
              )}
              <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
                <button type="button" className="btn btn--primary btn--sm" disabled={acting !== '' || generating} onClick={adoptDraft}>{acting === 'adopt' ? '正在保存…' : '采纳并保存'}</button>
                <button type="button" className="btn btn--sm" disabled={acting !== '' || generating} onClick={discardDraft}>{acting === 'discard' ? '正在放弃…' : '放弃草案'}</button>
                <span className="anno">采纳后：卷 + 锚点 + 卷纲 + {draftChapters.length} 条章纲一起落库；之后才能生成正文。</span>
              </div>
            </div>
          )}
        </section>
      )}

      {volumes.map((volume) => {
        const outline = outlineByVolume[volume.id];
        const acts = asArray(outline?.acts);
        const pacing = asObject(outline?.pacing);
        const constraints = asObject(outline?.constraints);
        const climax = asArray(pacing.climaxChapters);
        const rest = asArray(pacing.restChapters);

        return (
          <article className="card" key={volume.id} style={{ marginBottom: 18 }}>
            <div className="book__head">
              <span className="book__title">第 {volume.no} 卷 · {volume.name}</span>
              <span className={`status ${outline ? 'is-writing' : ''}`}>{outline ? '卷纲已备' : '还没有卷纲'}</span>
            </div>

            <div className="book__meta">
              <span className="chip">第 {volume.startChapter}–{volume.endChapter} 章</span>
              {outline?.structureType && <span className="chip">{outline.structureType}</span>}
              {outline?.drift && <span className="chip">锚点漂移</span>}
            </div>

            {(volume.goal || volume.fromState || volume.toState) && (
              <div className="field">
                <p className="field__k" data-en="goal">本卷要达成</p>
                <p className="field__v">{volume.goal || '—'}</p>
                {(volume.fromState || volume.toState) && (
                  <p className="field__v anno">{volume.fromState || '—'} → {volume.toState || '—'}</p>
                )}
              </div>
            )}

            {acts.length > 0 && (
              <div className="field">
                <p className="field__k" data-en="acts">幕</p>
                <div className="chip-row" style={{ flexWrap: 'wrap', gap: 8 }}>
                  {acts.map((act, index) => (
                    <span className="chip" key={act?.id ?? index} title={act?.summary || ''}>
                      {act?.name || `第 ${index + 1} 幕`}
                      {act?.startChapter !== undefined ? `（${act.startChapter}–${act.endChapter} 章）` : ''}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {(climax.length > 0 || rest.length > 0 || pacing.hookDensity !== undefined) && (
              <div className="field">
                <p className="field__k" data-en="pacing">节奏</p>
                <p className="field__v">
                  高潮章 {climax.length ? climax.join('、') : '—'}｜缓冲章 {rest.length ? rest.join('、') : '—'}
                  {pacing.hookDensity !== undefined ? `｜钩子密度 ${pacing.hookDensity}` : ''}
                </p>
              </div>
            )}

            {(constraints.timeline || asArray(constraints.rules).length > 0 || asArray(constraints.forbidden).length > 0) && (
              <div className="field">
                <p className="field__k" data-en="constraints">硬约束</p>
                {constraints.timeline && <p className="field__v anno">时间线：{constraints.timeline}</p>}
                {asArray(constraints.rules).length > 0 && <p className="field__v anno">规则：{asArray(constraints.rules).join('；')}</p>}
                {asArray(constraints.forbidden).length > 0 && <p className="field__v anno">禁止：{asArray(constraints.forbidden).join('；')}</p>}
              </div>
            )}

            {!outline && (
              <p className="anno">这一卷还没写卷纲。用上面的「生成卷纲草案」排一段，审核采纳后这里会列出幕、节奏与约束。</p>
            )}
          </article>
        );
      })}
    </main>
  );
}

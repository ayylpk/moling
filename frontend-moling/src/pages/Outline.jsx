import { useEffect, useState } from 'react';
import BlockTitle from '../components/BlockTitle.jsx';
import { useWorkbench } from '../layout/WorkbenchLayout.jsx';
import { api } from '../api/client.js';

/**
 * 大纲页：逐卷的三幕结构 / 张力曲线 / 硬约束。
 *
 * 数据来自两条接口：
 *   GET /api/novels/:id/volumes  —— 卷表（卷名 / 卷目标 / 起止章 / hasOutline）
 *   GET /api/novels/:id/outline  —— 锚点 + 每卷的卷纲本体（acts / pacing / constraints）
 * 两边按 volumeId 对齐。**卷表有几卷就列几卷**，没写卷纲的那一卷如实标出来，
 * 不拿别的卷的内容顶上（之前这一页摆的是另一本书的三幕与张力值）。
 */

const asArray = (value) => (Array.isArray(value) ? value : []);
const asObject = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});

export default function Outline() {
  const { novel } = useWorkbench();
  const [volumes, setVolumes] = useState([]);
  const [outlineByVolume, setOutlineByVolume] = useState({});
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!novel?.id) {
      setVolumes([]);
      setOutlineByVolume({});
      setLoaded(true);
      setError('');
      return undefined;
    }
    let active = true;
    setLoaded(false);
    setError('');
    Promise.all([api.listVolumes(novel.id), api.getOutline(novel.id)])
      .then(([volumeRows, outline]) => {
        if (!active) return;
        setVolumes(asArray(volumeRows));
        const map = {};
        for (const item of asArray(outline?.volumeOutlines)) map[item.volumeId] = item;
        setOutlineByVolume(map);
      })
      .catch((cause) => {
        if (!active) return;
        setVolumes([]);
        setOutlineByVolume({});
        setError(cause.message || '读不到大纲');
      })
      .finally(() => { if (active) setLoaded(true); });
    return () => { active = false; };
  }, [novel?.id]);

  if (!novel) {
    return (
      <main className="wb-page enter">
        <BlockTitle mark="纲" name="大纲" />
        <p className="anno">{loaded ? '书架上还没有书稿。' : '正在读取……'}</p>
      </main>
    );
  }

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
              <p className="anno">这一卷还没写卷纲。卷纲由架构师一次排一卷落库，落库后这里会列出幕、节奏与约束。</p>
            )}
          </article>
        );
      })}
    </main>
  );
}

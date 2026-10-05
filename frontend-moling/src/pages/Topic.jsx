import { useEffect, useState } from 'react';
import BlockTitle from '../components/BlockTitle.jsx';
import { useWorkbench } from '../layout/WorkbenchLayout.jsx';
import { api } from '../api/client.js';

/**
 * 选题页：一本书的「题眼」四问 —— logline / theme / coreConflict / endingDirection。
 *
 * 数据来自 `GET /api/novels/:id/outline` 的 `anchor`（`outline_anchors` 全篇锚点，
 * 由第一卷大纲定稿时一次写入，之后每卷只许原样回填）。
 * 锚点还没定稿就**直说没有** —— 之前这里摆的是另一本书的题眼。
 */
const FIELDS = [
  { zh: '一句话故事', en: 'logline' },
  { zh: '主题', en: 'theme' },
  { zh: '核心冲突', en: 'coreConflict' },
  { zh: '结局走向', en: 'endingDirection' },
];

export default function Topic() {
  const { novel } = useWorkbench();
  const [anchor, setAnchor] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!novel?.id) {
      setAnchor(null);
      setLoaded(true);
      setError('');
      return undefined;
    }
    let active = true;
    setLoaded(false);
    setError('');
    api.getOutline(novel.id)
      .then((result) => { if (active) setAnchor(result?.anchor ?? null); })
      .catch((cause) => { if (active) { setAnchor(null); setError(cause.message || '读不到锚点'); } })
      .finally(() => { if (active) setLoaded(true); });
    return () => { active = false; };
  }, [novel?.id]);

  if (!novel) {
    return (
      <main className="wb-page enter">
        <BlockTitle mark="题" name="选题" />
        <p className="anno">{loaded ? '书架上还没有书稿。' : '正在读取……'}</p>
      </main>
    );
  }

  return (
    <main className="wb-page enter">
      <BlockTitle mark="题" name="选题" />

      {error && <p className="anno">{error}</p>}
      {!loaded && !error && <p className="anno">正在取全篇锚点……</p>}

      {loaded && (
        <>
          <div className="dir-grid">
            {FIELDS.map((field) => (
              <article className="card dir-card" key={field.en}>
                <div className="field">
                  <p className="field__k" data-en={field.en}>{field.zh}</p>
                  <p className={`field__v${anchor ? ' anno' : ''}`}>{anchor?.[field.en] || '尚未定稿'}</p>
                </div>
              </article>
            ))}
          </div>

          <div className="card" style={{ marginTop: 22 }}>
            {anchor ? (
              <p className="anno">
                全篇锚点已由第 {anchor.lockedByVolume ?? '?'} 卷定稿（{anchor.lockedAt || '—'}），结构类型 {anchor.structureType || '—'}。
                后续卷只许原样回填，改了就是漂移。
              </p>
            ) : (
              <p className="anno">
                《{novel.title}》还没有题眼。这四个字段是「全篇锚点」，由第一卷大纲定稿时一次性写死，
                后续卷只许原样回填、不许重写。
              </p>
            )}
          </div>
        </>
      )}
    </main>
  );
}

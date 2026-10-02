import { useState } from 'react';
import BlockTitle from '../components/BlockTitle.jsx';

/**
 * 书稿页：DESIGN.md 第四节的三栏定稿 —— 章目录 200 / 正文 ≤68ch / 大纲浮签 260。
 * 浮签可收起（收拢成一枚竖排「签」口）。正文区是唯一允许出现宋体大字号的地方：
 * 17px / 行高 2.05 / 首行缩进两字，读稿如读书。
 *
 * 数据源：正文 = artifact_path 的 md（stage=chapter/polish 完成后落盘）；
 * 浮签 = outline.chapters[i] 的 hook/emotion。此处贴第 1 章真产物。
 */
const CH = {
  no: '第 1 章',
  title: '倒计时一百天',
  premise:
    '在虚构的南方地级市「临江市」，走读制普通高中「临江三中」的高三男生周砚，在第一段人生里因一场车祸失去了青梅竹马林晚，随后回到高三百日誓师那天重来一次；这一次他选择了一直住在隔街那栋空房子里的林晚，而这次重来本身要他用第二段人生的终点来偿还。',
  goal: '周砚想在百日誓师这天让苏晴注意到他，为此让陈默帮他把一封折成方块的纸条在散会时递到苏晴手上。',
  conflict: '纸条传到第三排就被郑立平截住，他当着全班念出「苏晴同学，放学能不能一起走一段」，然后把它贴在后墙倒计时数字旁边。',
  hook: '散会后所有人都往外走，周砚回头看了一眼后墙，那张纸条还贴在那儿，倒计时数字从纸背面透出来。',
  emotion: '从早上进教室时的兴奋，落到被念出纸条那一刻的僵。',
  words: '初稿 2976 → 润后 2972',
  body: [
    '六月还没到，教室已经热了。',
    '周砚进教室的时候，早读的太阳正从东边那排窗户斜进来，整排桌面晒得发白。他坐靠窗第三排，手一按上去，木面烫手。他把书包从肩上卸下来，侧袋里那把黑柄折叠伞磕了一下桌腿。拉链拉到最上面，脖子那块有点闷，他没拉下来。',
    '后墙黑板上，郑立平已经站在那儿了。',
    '粉笔在手里转了一圈，第一笔没落下去。郑立平左手无名指第二指节缺一截，粉笔从他指缝里滑出去，掉在讲台边上，弹了一下。他弯腰捡起来，用剩下的那截手指重新夹紧。',
  ],
  said: '「一百天。」',
};

// 左栏章目录：前 6 章真名（outline.chapters），余者待接
const TOC = [
  ['01', '倒计时一百天'],
  ['02', '坡道下面那棵树'],
  ['03', '第一次月考'],
  ['04', '梅雨里的伞'],
  ['05', '晚自习二十二点十分'],
  ['06', '隔街巷的第四级楼梯'],
];

export default function Manuscript() {
  const [noteOpen, setNoteOpen] = useState(true);

  return (
    <main className="wb-page enter" style={{ maxWidth: 'none' }}>
      <BlockTitle
        mark="稿"
        name="书稿"
        anno="artifact_path · chapter-1-polished.json → 本 md"
      />

      <div className={`ms${noteOpen ? '' : ' ms--hide-note'}`}>
        {/* 一、章目录 */}
        <nav className="ms__toc">
          {TOC.map(([no, name], i) => (
            <div className={`toc-item${i === 0 ? ' is-active' : ''}`} key={no}>
              <span className="toc-num">{no}</span>
              <span className="toc-name">{name}</span>
            </div>
          ))}
          <div className="toc-item" style={{ color: 'var(--m-ink-3)' }}>
            <span className="toc-num">…</span>
            <span className="toc-name">共 50 章待接</span>
          </div>
        </nav>

        {/* 二、正文 */}
        <article className="ms__paper">
          <h2 className="ms__title">
            {CH.no}　{CH.title}
          </h2>

          <blockquote className="ms__premise">{CH.premise}</blockquote>

          <div className="ms__meta anno">
            <p><b style={{ color: 'var(--m-ink-2)' }}>本章目标</b>　{CH.goal}</p>
            <p style={{ marginTop: 6 }}><b style={{ color: 'var(--m-ink-2)' }}>冲突</b>　{CH.conflict}</p>
          </div>

          <div className="ms__body">
            {CH.body.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
            <p className="ms__line">{CH.said}</p>
          </div>

          <p className="ms__stat anno">
            字数 {CH.words} · chapter <span style={{ color: 'var(--m-indigo)' }}>done</span> ·
            polish <span style={{ color: 'var(--m-indigo)' }}>done</span>
          </p>
        </article>

        {/* 三、大纲浮签（右上收放） */}
        <aside className="ms__note">
          {noteOpen ? (
            <div className="note-card">
              <div className="note-card__head">
                <span>大纲浮签</span>
                <button type="button" className="btn btn--sm" onClick={() => setNoteOpen(false)}>
                  收起
                </button>
              </div>
              <div className="note-card__body">
                <div className="field">
                  <p className="field__k">结尾钩子</p>
                  <p className="field__v">{CH.hook}</p>
                </div>
                <div className="field">
                  <p className="field__k">情绪落点</p>
                  <p className="field__v">{CH.emotion}</p>
                </div>
                <p className="anno" style={{ marginTop: 12 }}>
                  chapters[0].hook / emotion · 写完自动核销
                </p>
              </div>
            </div>
          ) : (
            <button type="button" className="note-tab" onClick={() => setNoteOpen(true)}>
              浮签
            </button>
          )}
        </aside>
      </div>
    </main>
  );
}

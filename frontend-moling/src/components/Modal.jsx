import { createPortal } from 'react-dom';

/**
 * 弹窗外壳：遮罩 + 居中 + **挂到 document.body 上**。
 *
 * ── 为什么必须 portal，不能就地渲染 ──
 * 遮罩是 `position: fixed; inset: 0`，看着像"贴视口"，其实**只要有一个祖先带 transform，
 * 基准就变成那个祖先**（filter / perspective / will-change / contain: paint 同理）。
 * 页面外壳上的出场动画 `.enter`（`@keyframes rise` 动的正是 transform）就是这种祖先 ——
 * 于是遮罩贴的是 `main.wb-page`，弹窗按内容区居中：右侧偏出去一截，顶部还被顶栏压下去。
 *
 * 这类 bug 的坑在于它只在**那段动画还在生效**时成立，看起来像"偶发的没居中"。
 * 挂到 body 上就与祖先彻底无关 —— 以后谁在页面外壳上加 transform 都不会复发。
 *
 * 传了 `onSubmit` 就把弹窗本体渲染成 `<form>`（类名不变，样式一律不动）；
 * 没传就是普通 `div`（纯确认框）。这样"是不是表单"由调用方决定，外壳只管居中。
 */
export default function Modal({ children, slim = false, onSubmit, onBackdrop, busy = false, onEscape }) {
  const boxClass = `novel-modal${slim ? ' novel-modal--slim' : ''}`;
  const common = {
    className: boxClass,
    onKeyDown: (event) => { if (event.key === 'Escape' && onEscape && !busy) onEscape(); },
  };

  return createPortal(
    <div
      className="novel-modal__shade"
      role="presentation"
      onMouseDown={(event) => {
        // 只有点在遮罩本身（而不是从弹窗里按下、拖出来松手）才算"点外面"
        if (onBackdrop && !busy && event.target === event.currentTarget) onBackdrop();
      }}
    >
      {onSubmit
        ? <form {...common} onSubmit={onSubmit}>{children}</form>
        : <div {...common}>{children}</div>}
    </div>,
    document.body,
  );
}

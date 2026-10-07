import { useEffect, useRef } from 'react';
import Modal from './Modal.jsx';

/**
 * 应用内确认 / 输入弹窗 —— 用来代替 `window.confirm` 与 `window.prompt`。
 *
 * ── 为什么原生那两个不能用 ──
 * 它们在**嵌入式预览和各家 WebView 里会被静默吞掉**（自动 dismiss），表现是
 * "点了删除按钮毫无反应"：既不弹框、也不执行、还不报错。用户只会以为按钮坏了。
 * 上一轮把建书表单里的 `window.prompt` 换成内联输入框时，漏掉了确认框这一处，
 * 于是删除成了唯一还依赖原生对话框的动作 —— 也就成了唯一会"没反应"的动作。
 *
 * ── 用法 ──
 * 它**自己不管状态**：要问什么、问完干什么，都由调用方拿 `useState` 管。
 * 这样删除、改名这些不同语义的动作共用一个壳，而各自的收尾逻辑留在各自的页面里。
 * 居中与挂载点交给 `Modal`（贴视口，不受页面外壳的 transform 影响）。
 */
export default function AskModal({
  eyebrow = 'CONFIRM',
  title,
  note,            // 说明文字：把"会发生什么"写清楚，别只写"确定吗"
  input,           // 可选：{ label, value, placeholder, onChange } —— 给了就是输入式
  confirmLabel = '确定',
  danger = false,  // 破坏性动作（删除之类）：按钮走朱砂
  busy = false,
  error = '',
  onCancel,
  onConfirm,
}) {
  const fieldRef = useRef(null);
  const confirmRef = useRef(null);

  /*
   * 打开即聚焦：输入式落在输入框，纯确认落在确认按钮 —— 两种都能直接敲回车。
   * 依赖用 `Boolean(input)`：父组件每次渲染都新建 input 对象，直接依赖它会让
   * 这个 effect 每渲染一次就跑一遍，把焦点从用户手里抢回输入框。
   */
  useEffect(() => {
    if (input) fieldRef.current?.focus();
    else confirmRef.current?.focus();
  }, [Boolean(input)]);

  return (
    <Modal
      slim
      busy={busy}
      onBackdrop={onCancel}
      onEscape={onCancel}
      onSubmit={(event) => { event.preventDefault(); if (!busy) onConfirm(); }}
    >
      <div className="novel-modal__head">
        <div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2></div>
        <button type="button" className="novel-modal__close" aria-label="关闭" disabled={busy} onClick={onCancel}>×</button>
      </div>

      {note && <p className="anno" style={{ lineHeight: 1.9 }}>{note}</p>}

      {input && (
        <label className="novel-form__field">
          <span>{input.label}</span>
          <input
            ref={fieldRef}
            value={input.value}
            placeholder={input.placeholder}
            onChange={(event) => input.onChange(event.target.value)}
          />
        </label>
      )}

      {error && <p className="novel-form__error" role="alert">{error}</p>}

      <div className="novel-modal__actions">
        <button type="button" className="btn" disabled={busy} onClick={onCancel}>取消</button>
        <button ref={confirmRef} type="submit" className={`btn ${danger ? 'btn--danger' : 'btn--primary'}`} disabled={busy}>
          {busy ? '处理中…' : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

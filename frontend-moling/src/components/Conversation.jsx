import { useEffect, useState } from 'react';
import { useWorkbench } from '../layout/WorkbenchLayout.jsx';
import { api } from '../api/client.js';

/**
 * 对话栏：中心 Agent「灵」的通道，只在「执笔」模式出现（右侧纸色柱）。
 * 收起后剩 48px 竖轨；「放大」会变成覆盖在画布上的大窗，读长回复用。
 *
 * ── 聊天记录存在上一层（WorkbenchLayout），不在这里 ──
 * 这个组件只在执笔模式挂载：作者一回文库看卷章，它就卸载。
 * 状态放这层的话，切一次页面记录就清零 —— 这正是被吐槽"切换一下页面就没内容了"的原因。
 * （它解决"切页面丢"；**刷新仍会丢** —— 那得给网页这条 chat 路径挂 checkpointer，
 * 现在只有开发 CLI 那条有。）
 */
export default function Conversation({ collapsed, maximized, onToggleMax, onToggle }) {
  const { novel, chatMessages, setChatMessages } = useWorkbench();
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  /** 这本书现在到哪了（来自 `/workflow` 的 label，例如「正在整理世界观」）。
   *  空态得报出这本书做到哪了，不然作者会以为 Agent 根本没读他的书。 */
  const [where, setWhere] = useState('');
  /** 待审核草案的摘要（阶段名 + 对象），生成后刷新。空数组 = 没有待审核的东西。 */
  const [pending, setPending] = useState([]);

  const stageLabel = { world: '世界观', cast: '角色/地点', volume_outline: '卷纲', prose: '正文', decision: '裁决' };
  const pendingLabel = (item) => {
    const base = stageLabel[item.stage] || item.stage;
    if (item.stage === 'prose') return `正文第 ${item.targetKey} 章`;
    if (item.stage === 'volume_outline') return `卷纲（${item.targetKey}）`;
    if (item.stage === 'cast' && item.targetKey && !item.targetKey.startsWith('need:')) return `角色/地点：${item.targetKey}`;
    return base;
  };

  const loadPending = (novelId, active) =>
    api.listDrafts(novelId)
      .then((items) => { if (active) setPending(Array.isArray(items) ? items : []); })
      .catch(() => { if (active) setPending([]); });

  useEffect(() => { setDraft(''); setError(''); }, [novel?.id]);
  useEffect(() => {
    if (!novel?.id) { setWhere(''); setPending([]); return undefined; }
    let active = true;
    api.workflow(novel.id)
      .then((result) => { if (active) setWhere(typeof result?.label === 'string' ? result.label : ''); })
      .catch(() => { if (active) setWhere(''); });   // 读不到就不摆 —— 摆个假状态比空着更糟
    loadPending(novel.id, active);
    return () => { active = false; };
  }, [novel?.id]);

  const send = async (event) => {
    event.preventDefault();
    const message = draft.trim();
    if (!novel || !message || sending) return;
    const next = [...chatMessages, { role: 'user', content: message }];
    setChatMessages(next); setDraft(''); setError(''); setSending(true);
    try {
      const result = await api.chat(novel.id, message, chatMessages);
      setChatMessages([...next, { role: 'assistant', content: result.message || '中心 Agent 没有返回内容。' }]);
    } catch (cause) { setError(cause.message || '中心 Agent 暂时无法连接。'); }
    finally { setSending(false); loadPending(novel.id, true); }
  };

  /*
   * Enter 直接发送。**必须排除输入法合成中**：中文打字选词时的那个 Enter 是"确认候选"，
   * 不是"发送" —— 不拦的话，作者每打一句话都会被抢先发出去。
   * 换行用 Shift+Enter。
   */
  const onKeyDown = (event) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    send(event);
  };

  return (
    <aside className={`ws__chat${collapsed ? ' is-collapsed' : ''}${maximized ? ' is-max' : ''}`}>
      <div className="conversation__head">
        {!collapsed && (
          <div>
            <span className="conversation__eyebrow">协作频道</span>
            <h2>
              <span className="conversation__seal">灵</span>中心 Agent
            </h2>
          </div>
        )}
        <div className="conversation__head-actions">
          {!collapsed && (
            <button type="button" className="conversation__collapse" onClick={onToggleMax} title="放大成一个宽窗，方便读长回复">
              {maximized ? '还原' : '放大'}
            </button>
          )}
          <button type="button" className="conversation__collapse" onClick={onToggle}>
            {collapsed ? '展开对话' : '收起对话'}
          </button>
        </div>
      </div>

      {!collapsed && (
        <>
          <div className="conversation__context">
            <span className="status is-writing">{novel ? '已连接' : '等待选书'}</span>
            <strong>{novel ? `《${novel.title}》` : '请先创建或选择一本小说'}</strong>
            <span className="anno">{where || '当前阶段：等待指令（一次只做一个生成阶段）'}</span>
            {pending.length > 0 && (
              <span className="anno">
                待审核草案：{pending.map(pendingLabel).join('、')} —— 回复「采纳…」或到对应页面点「采纳并保存」
              </span>
            )}
          </div>

          <div className="conversation__messages">
            {chatMessages.length === 0 && (
              <div className="conversation__message is-system">
                <span className="conversation__message-label">使用说明</span>
                {where && <p><strong>{where}</strong>——说一声下一步做什么，它会从当前进度接着做。</p>}
                <p>一轮只做一个生成阶段：生成完会停下，把草案交给你审核；你说「采纳」它才落库。</p>
              </div>
            )}
            {chatMessages.map((item, index) => <div className={`conversation__message is-${item.role === 'user' ? 'user' : 'agent'}`} key={`${item.role}-${index}`}><span className="conversation__message-label">{item.role === 'user' ? '你' : '中心 Agent'}</span><p>{item.content}</p></div>)}
            {sending && (
              <div className="conversation__message is-system">
                <span className="conversation__message-label">中心 Agent</span>
                <p>正在处理：{where || '读取小说状态'}……本轮只做一个生成阶段，完成后会停下来等你审核。</p>
              </div>
            )}
          </div>

          {error && <p className="conversation__error">{error}</p>}
          <form className="conversation__composer" onSubmit={send}>
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onKeyDown}
              disabled={!novel || sending}
              placeholder={novel ? '告诉中心 Agent 下一步怎么做…（Enter 发送，Shift+Enter 换行）' : '先在书架创建一本小说'}
            />
            <button type="submit" className="btn btn--primary" disabled={!novel || !draft.trim() || sending}>{sending ? '处理中…' : '发送指令'}</button>
          </form>
        </>
      )}
    </aside>
  );
}

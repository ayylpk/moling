import { useEffect, useState } from 'react';
import { useWorkbench } from '../layout/WorkbenchLayout.jsx';
import { api } from '../api/client.js';

/**
 * 对话栏：中心 Agent「灵」的单通道，只在「执笔」模式出现（右侧纸色柱）。
 * 收起后剩 48px 竖轨，按钮变竖排「展开对话」。
 * 消息通过 storage API 转交中心 Agent；ask-human 只有 Agent 真正提出时再展示。
 */
export default function Conversation({ collapsed, onToggle }) {
  const { novel } = useWorkbench();
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setMessages([]); setDraft(''); setError(''); }, [novel?.id]);
  const send = async (event) => {
    event.preventDefault();
    const message = draft.trim();
    if (!novel || !message || sending) return;
    const next = [...messages, { role: 'user', content: message }];
    setMessages(next); setDraft(''); setError(''); setSending(true);
    try {
      const result = await api.chat(novel.id, message, messages);
      setMessages([...next, { role: 'assistant', content: result.message || '中心 Agent 没有返回内容。' }]);
    } catch (cause) { setError(cause.message || '中心 Agent 暂时无法连接。'); }
    finally { setSending(false); }
  };

  return (
    <aside className={`ws__chat${collapsed ? ' is-collapsed' : ''}`}>
      <div className="conversation__head">
        {!collapsed && (
          <div>
            <span className="conversation__eyebrow">协作频道</span>
            <h2>
              <span className="conversation__seal">灵</span>中心 Agent
            </h2>
          </div>
        )}
        <button type="button" className="conversation__collapse" onClick={onToggle}>
          {collapsed ? '展开对话' : '收起对话'}
        </button>
      </div>

      {!collapsed && (
        <>
          <div className="conversation__context">
            <span className="status is-writing">{novel ? '已连接' : '等待选书'}</span>
            <strong>{novel ? `《${novel.title}》` : '请先创建或选择一本小说'}</strong>
            <span className="anno">中心 Agent 自动负责后续编排</span>
          </div>

          <div className="conversation__messages">
            {messages.length === 0 && <div className="conversation__message is-system"><span className="conversation__message-label">使用说明</span><p>直接告诉中心 Agent 你想写什么。世界观、角色、大纲和章节由它按流程处理。</p></div>}
            {messages.map((item, index) => <div className={`conversation__message is-${item.role === 'user' ? 'user' : 'agent'}`} key={`${item.role}-${index}`}><span className="conversation__message-label">{item.role === 'user' ? '你' : '中心 Agent'}</span><p>{item.content}</p></div>)}
            {sending && <div className="conversation__message is-system"><span className="conversation__message-label">中心 Agent</span><p>正在读取小说状态并安排下一步……</p></div>}
          </div>

          {error && <p className="conversation__error">{error}</p>}
          <form className="conversation__composer" onSubmit={send}><textarea value={draft} onChange={(event) => setDraft(event.target.value)} disabled={!novel || sending} placeholder={novel ? '告诉中心 Agent 下一步怎么做…' : '先在书架创建一本小说'} /><button type="submit" className="btn btn--primary" disabled={!novel || !draft.trim() || sending}>{sending ? '处理中…' : '发送指令'}</button></form>
        </>
      )}
    </aside>
  );
}

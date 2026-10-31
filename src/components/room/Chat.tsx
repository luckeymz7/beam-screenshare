import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { useChat } from '@livekit/components-react';
import { Icon } from '../Icon';
import { useT } from '../i18n';

const time = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export function Chat({ chat, onClose }: { chat: ReturnType<typeof useChat>; onClose: () => void }) {
  const t = useT();
  const [text, setText] = useState('');
  const list = useRef<HTMLOListElement>(null);

  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [chat.chatMessages.length]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const message = text.trim();
    if (!message) return;
    setText('');
    await chat.send(message.slice(0, 500));
  };

  return (
    <aside className="chat" aria-label={t('room.chat')}>
      <header className="chat-head">
        <span className="eyebrow">{t('chat.title')}</span>
        <button className="icon" onClick={onClose} aria-label={t('chat.close')}>
          <Icon name="close" size={14} />
        </button>
      </header>
      <ol className="chat-list" ref={list}>
        {chat.chatMessages.length === 0 && <li className="chat-empty">{t('chat.empty')}</li>}
        {chat.chatMessages.map((m) => (
          <li key={m.id} className={m.from?.isLocal ? 'mine' : ''}>
            <span className="chat-meta mono">
              {m.from?.isLocal ? t('tile.you') : m.from?.name || t('chat.someone')} · {time(m.timestamp)}
            </span>
            <span className="chat-text">{m.message}</span>
          </li>
        ))}
      </ol>
      <form className="chat-form" onSubmit={submit}>
        <input
          className="input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t('chat.placeholder')}
          maxLength={500}
          // On a phone the keyboard would cover the chat as soon as it opens
          autoFocus={!matchMedia('(pointer: coarse)').matches}
        />
        <button className="icon" disabled={chat.isSending || !text.trim()} aria-label={t('chat.send')}>
          <Icon name="send" size={15} />
        </button>
      </form>
    </aside>
  );
}

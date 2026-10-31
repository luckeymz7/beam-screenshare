import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Avatar } from './Account';
import { Icon } from './Icon';
import { translator, type Lang } from '../lib/i18n';
import type { Friend } from '../lib/friends';

type Lists = { friends: Friend[]; incoming: Friend[]; outgoing: Friend[]; code: string };

/** Your friends (who's live first), requests both ways, and your friend link. */
export default function FriendsApp({ lang, initial }: { lang: Lang; initial: Lists }) {
  const t = useMemo(() => translator(lang), [lang]);
  const [data, setData] = useState(initial);
  const [copied, setCopied] = useState(false);
  const [code, setCode] = useState('');
  const [note, setNote] = useState('');
  const [armed, setArmed] = useState<string | null>(null);
  const link = typeof location === 'undefined' ? `/add/${data.code}` : `${location.origin}/add/${data.code}`;

  const reload = () =>
    fetch('/api/friends')
      .then((r) => r.json())
      .then(setData, () => {});
  // Who's live changes: refresh every 20 s while the page is visible
  useEffect(() => {
    const id = setInterval(() => !document.hidden && reload(), 20_000);
    return () => clearInterval(id);
  }, []);

  const act = async (action: 'add' | 'accept' | 'remove', body: { id?: string; code?: string }) => {
    const res = await fetch('/api/friends', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...body }),
    }).catch(() => null);
    await reload();
    return res;
  };

  const addByCode = async (e: FormEvent) => {
    e.preventDefault();
    const clean = code.trim().split('/').pop() ?? '';
    if (!clean) return;
    const res = await act('add', { code: clean });
    const rel = res?.ok ? (await res.json()).relation : null;
    setNote(rel === 'outgoing' ? t('friends.requested') : rel === 'friends' ? t('friends.isFriend') : rel === 'self' ? t('friends.self') : t('friends.notFound'));
    if (res?.ok) setCode('');
  };

  const live = data.friends.filter((f) => f.live);
  const rest = data.friends.filter((f) => !f.live);

  return (
    <div className="friends">
      <section className="friends-link">
        <p className="label">{t('friends.link')}</p>
        <div className="link-row">
          <code className="mono">{link}</code>
          <button
            className="btn"
            onClick={async () => {
              await navigator.clipboard.writeText(link).catch(() => {});
              setCopied(true);
              setTimeout(() => setCopied(false), 1600);
            }}
          >
            <Icon name={copied ? 'check' : 'link'} size={14} /> {copied ? t('friends.copied') : t('friends.copy')}
          </button>
        </div>
        <p className="muted small">{t('friends.linkHint')}</p>
        <form className="link-row" onSubmit={addByCode}>
          <input
            className="input"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder={t('friends.codePlaceholder')}
            aria-label={t('friends.byCode')}
          />
          <button className="btn">{t('friends.add')}</button>
        </form>
        {note && <p className="muted small">{note}</p>}
      </section>

      {data.incoming.length > 0 && (
        <FriendList title={t('friends.incoming')}>
          {data.incoming.map((f) => (
            <Row key={f.id} f={f} t={t}>
              <button className="btn primary" onClick={() => act('accept', { id: f.id })}>
                {t('friends.accept')}
              </button>
              <button className="btn" onClick={() => act('remove', { id: f.id })}>
                {t('friends.decline')}
              </button>
            </Row>
          ))}
        </FriendList>
      )}

      {live.length > 0 && (
        <FriendList title={t('friends.live')}>
          {live.map((f) => (
            <Row key={f.id} f={f} t={t}>
              {f.live?.room && (
                <a className="btn primary" href={`/r/${f.live.room}`}>
                  {t('friends.join')}
                </a>
              )}
            </Row>
          ))}
        </FriendList>
      )}

      <FriendList title={t('friends.title')}>
        {data.friends.length === 0 ? (
          <li className="friends-empty">{t('friends.empty')}</li>
        ) : (
          rest.map((f) => (
            <Row key={f.id} f={f} t={t}>
              <button
                className={`btn ${armed === f.id ? 'danger' : 'ghost'}`}
                onClick={() => (armed === f.id ? act('remove', { id: f.id }) : setArmed(f.id))}
                onBlur={() => setArmed(null)}
              >
                {armed === f.id ? t('friends.removeConfirm') : t('friends.remove')}
              </button>
            </Row>
          ))
        )}
      </FriendList>

      {data.outgoing.length > 0 && (
        <FriendList title={t('friends.outgoing')}>
          {data.outgoing.map((f) => (
            <Row key={f.id} f={f} t={t}>
              <button className="btn ghost" onClick={() => act('remove', { id: f.id })}>
                {t('friends.cancel')}
              </button>
            </Row>
          ))}
        </FriendList>
      )}
    </div>
  );
}

function FriendList({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <p className="label">{title}</p>
      <ul className="friend-list">{children}</ul>
    </section>
  );
}

function Row({ f, t, children }: { f: Friend; t: ReturnType<typeof translator>; children?: React.ReactNode }) {
  const status = f.live
    ? f.live.title
      ? t(f.live.hosting ? 'friends.hosting' : 'friends.inRoom', { title: f.live.title })
      : t('friends.inPrivate')
    : f.bio;
  return (
    <li className={`friend ${f.theme ? 'themed' : ''}`} style={f.theme ? { '--theme-accent': f.theme.accent } as React.CSSProperties : undefined}>
      <span className="friend-avatar">
        <Avatar name={f.name} image={f.image} size={36} />
        {f.live && <span className="live-dot" />}
      </span>
      <span className="friend-text">
        <span className="friend-name">
          {f.name}
          {f.premium && <span className="star">✦</span>}
        </span>
        {status && <span className={`friend-status ${f.live ? 'on' : ''}`}>{status}</span>}
      </span>
      <span className="friend-actions">{children}</span>
    </li>
  );
}

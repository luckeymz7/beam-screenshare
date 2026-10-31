import { useEffect, useState } from 'react';
import { Icon } from './Icon';
import { since } from '../lib/client';
import { translator, type Lang } from '../lib/i18n';
import type { RoomCard } from '../lib/rooms';

// The host's browser refreshes the preview every few seconds while sharing
const FRESH = 45_000;

export default function RoomList({ lang, initial, failed }: { lang: Lang; initial: RoomCard[]; failed?: boolean }) {
  const t = translator(lang);
  const [rooms, setRooms] = useState(initial);
  const [error, setError] = useState(!!failed);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const refresh = async () => {
      if (document.hidden) return;
      try {
        const res = await fetch('/api/rooms');
        if (!res.ok) throw new Error();
        setRooms((await res.json()).rooms);
        setError(false);
      } catch {
        setError(true);
      }
      setNow(Date.now());
    };
    const id = setInterval(refresh, 10_000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);

  if (rooms.length === 0) {
    return (
      <div className="empty hatch">
        <p>{error ? t('list.failed') : t('list.empty')}</p>
        <a href="#start" className="link">
          {t('list.startFirst')}
        </a>
      </div>
    );
  }

  return (
    <ul className="rooms">
      {rooms.map((r) => {
        const sharing = r.thumbAt !== null && now - r.thumbAt < FRESH;
        return (
          <li key={r.id}>
            <a href={`/r/${r.id}`} className="room">
              <span className="preview">
                {sharing ? (
                  <img src={`/api/rooms/${r.id}/thumb?v=${r.thumbAt}`} alt="" loading="lazy" />
                ) : (
                  <span className="waiting hatch">{t('list.waiting')}</span>
                )}
                <span className="badge mono">
                  <span className="live-dot" /> {t('list.live')}
                </span>
              </span>
              <span className="meta">
                <span className="title">{r.title}</span>
                <span className="sub mono">
                  {r.host} · {since(t, r.createdAt, now)}
                  <span className="viewers">
                    <Icon name="users" size={12} /> {r.participants}
                  </span>
                </span>
              </span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}

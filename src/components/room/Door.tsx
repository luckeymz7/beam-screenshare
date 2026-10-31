import { useEffect, useState } from 'react';
import { Avatar } from '../Account';
import { Icon } from '../Icon';
import { useT } from '../i18n';

type Knock = { id: string; name: string; image: string | null };

/** Host of a room that asks first: who is waiting at the door, to let in or not. */
export function Door({ roomId, hostKey }: { roomId: string; hostKey: string }) {
  const t = useT();
  const [waiting, setWaiting] = useState<Knock[]>([]);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      if (document.hidden) return;
      try {
        const res = await fetch(`/api/rooms/${roomId}/requests`, { headers: { 'x-host-key': hostKey } });
        if (res.ok && alive) setWaiting((await res.json()).requests);
      } catch {}
    };
    poll();
    const id = setInterval(poll, 3000);
    document.addEventListener('visibilitychange', poll);
    return () => {
      alive = false;
      clearInterval(id);
      document.removeEventListener('visibilitychange', poll);
    };
  }, [roomId, hostKey]);

  const decide = (id: string, accept: boolean) => {
    setWaiting((w) => w.filter((k) => k.id !== id));
    fetch(`/api/rooms/${roomId}/requests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-host-key': hostKey },
      body: JSON.stringify({ id, accept }),
    }).catch(() => {});
  };

  if (waiting.length === 0) return null;
  return (
    <section className="door" aria-label={t('door.title')} aria-live="polite">
      <p className="door-title">
        <Icon name="door" size={14} /> {t('door.waiting', { n: waiting.length })}
      </p>
      <ul>
        {waiting.map((k) => (
          <li key={k.id}>
            <Avatar name={k.name} image={k.image} size={26} />
            <span className="door-name">{k.name}</span>
            <button className="btn primary" onClick={() => decide(k.id, true)}>
              {t('door.letIn')}
            </button>
            <button className="btn" onClick={() => decide(k.id, false)}>
              {t('door.deny')}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

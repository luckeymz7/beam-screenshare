import { useEffect, useState } from 'react';
import { Icon } from './Icon';
import { useT } from './i18n';
import type { Relation } from '../lib/friends';

type State = Relation | 'anonymous' | 'loading';

/** Add / accept / already friends, for someone with an account. */
export function FriendButton({ userId }: { userId: string }) {
  const t = useT();
  const [state, setState] = useState<State>('loading');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`/api/friends?with=${encodeURIComponent(userId)}`)
      .then((r) => r.json())
      .then((d) => setState(d.relation), () => setState('none'));
  }, [userId]);

  const act = async (action: 'add' | 'accept') => {
    setBusy(true);
    const res = await fetch('/api/friends', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, id: userId }),
    }).catch(() => null);
    if (res?.ok) setState((await res.json()).relation);
    setBusy(false);
  };

  if (state === 'loading' || state === 'self') return null;
  if (state === 'anonymous') {
    return (
      <button className="btn friend-btn" onClick={() => dispatchEvent(new Event('beam:login'))}>
        <Icon name="users" size={14} /> {t('friends.loginToAdd')}
      </button>
    );
  }
  if (state === 'friends') {
    return (
      <span className="friend-state">
        <Icon name="check" size={14} /> {t('friends.isFriend')}
      </span>
    );
  }
  if (state === 'outgoing') {
    return (
      <span className="friend-state">
        <Icon name="check" size={14} /> {t('friends.requested')}
      </span>
    );
  }
  return (
    <button className="btn primary friend-btn" disabled={busy} onClick={() => act(state === 'incoming' ? 'accept' : 'add')}>
      <Icon name="users" size={14} /> {state === 'incoming' ? t('friends.accept') : t('friends.add')}
    </button>
  );
}

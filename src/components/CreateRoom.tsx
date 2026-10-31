import { useEffect, useState, type FormEvent } from 'react';
import { Icon } from './Icon';
import { saveHostKey, saveName, savedName } from '../lib/client';
import { errorText, translator, type Lang } from '../lib/i18n';

// Same list the server accepts (src/lib/livekit.ts); 0 is no limit
const SIZES = [0, 2, 5, 10, 25, 50];

export default function CreateRoom({ lang, myName }: { lang: Lang; myName?: string | null }) {
  const t = translator(lang);
  const [title, setTitle] = useState('');
  const [name, setName] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [approval, setApproval] = useState(false);
  const [max, setMax] = useState(0);
  const [share, setShare] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => setName(savedName() || myName || ''), [myName]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          name,
          visibility,
          approval: visibility === 'private' && approval,
          max: max || null,
          share,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(errorText(t, data, 'create.failed'));
      saveName(name.trim());
      saveHostKey(data.id, data.hostKey);
      location.href = `/r/${data.id}`;
    } catch (err) {
      setError(err instanceof TypeError ? t('err.network') : (err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form className="create" onSubmit={submit}>
      <div className="create-grid">
        <label className="field">
          <span className="label">{t('create.title')}</span>
          <input
            className="input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t('create.titlePlaceholder')}
            maxLength={60}
            required
          />
        </label>
        <label className="field">
          <span className="label">{t('create.name')}</span>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Lucas"
            maxLength={32}
            autoComplete="nickname"
            required
          />
        </label>
      </div>
      <div className="create-foot">
        <div className="seg" role="group" aria-label={t('create.who')}>
          <button type="button" aria-pressed={visibility === 'public'} onClick={() => setVisibility('public')}>
            <Icon name="globe" size={14} /> {t('create.public')}
          </button>
          <button type="button" aria-pressed={visibility === 'private'} onClick={() => setVisibility('private')}>
            <Icon name="lock" size={14} /> {t('create.private')}
          </button>
        </div>
        <p className="hint">{visibility === 'public' ? t('create.publicHint') : t('create.privateHint')}</p>
        <button className="btn primary" disabled={busy}>
          {busy ? t('create.creating') : t('create.go')}
          <Icon name="arrow" size={14} />
        </button>
      </div>

      <div className="create-options">
        <label className="option">
          <Icon name="users" size={15} />
          <span>{t('create.max')}</span>
          <select className="input select" value={max} onChange={(e) => setMax(Number(e.target.value))}>
            {SIZES.map((n) => (
              <option key={n} value={n}>
                {n ? t('create.upTo', { n }) : t('create.noLimit')}
              </option>
            ))}
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} />
          <span>
            <strong>{t('create.share')}</strong> {t('create.shareHint')}
          </span>
        </label>
        {visibility === 'private' && (
          <label className="check">
            <input type="checkbox" checked={approval} onChange={(e) => setApproval(e.target.checked)} />
            <span>
              <strong>{t('create.approval')}</strong> {t('create.approvalHint')}
            </span>
          </label>
        )}
      </div>
      {error && <p className="error">{error}</p>}
    </form>
  );
}

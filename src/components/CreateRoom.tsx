import { useEffect, useState, type FormEvent } from 'react';
import { Icon } from './Icon';
import { saveHostKey, saveName, savedName } from '../lib/client';

export default function CreateRoom() {
  const [title, setTitle] = useState('');
  const [name, setName] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => setName(savedName()), []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, name, visibility }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Could not create the room.');
      saveName(name.trim());
      saveHostKey(data.id, data.hostKey);
      location.href = `/r/${data.id}`;
    } catch (err) {
      setError((err as Error).message === 'Failed to fetch' ? 'Could not reach the server.' : (err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form className="create" onSubmit={submit}>
      <div className="create-grid">
        <label className="field">
          <span className="label">room title</span>
          <input
            className="input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Fixing the login bug, live"
            maxLength={60}
            required
          />
        </label>
        <label className="field">
          <span className="label">your name</span>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Lucas"
            maxLength={32}
            required
          />
        </label>
      </div>
      <div className="create-foot">
        <div className="seg" role="group" aria-label="Who can find the room">
          <button type="button" aria-pressed={visibility === 'public'} onClick={() => setVisibility('public')}>
            <Icon name="globe" size={14} /> Public
          </button>
          <button type="button" aria-pressed={visibility === 'private'} onClick={() => setVisibility('private')}>
            <Icon name="lock" size={14} /> Private
          </button>
        </div>
        <p className="hint">
          {visibility === 'public'
            ? 'Listed below with a live preview of your screen.'
            : 'Not listed. Only people with the link can join.'}
        </p>
        <button className="btn primary" disabled={busy}>
          {busy ? 'Creating…' : 'Go live'}
          <Icon name="arrow" size={14} />
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </form>
  );
}

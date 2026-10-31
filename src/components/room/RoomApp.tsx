import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { LiveKitRoom, RoomAudioRenderer } from '@livekit/components-react';
import { DisconnectReason, VideoPresets, type RoomOptions } from 'livekit-client';
import { Icon } from '../Icon';
import { hostKeyFor, saveName, savedName } from '../../lib/client';
import type { Role, RoomInfo } from '../../lib/livekit';
import { RoomView } from './RoomView';

type Session = { token: string; serverUrl: string; role: Role; room: RoomInfo };
type Phase = 'prejoin' | 'joined' | 'left' | 'removed' | 'ended';

export default function RoomApp({ room }: { room: RoomInfo }) {
  const [phase, setPhase] = useState<Phase>('prejoin');
  const [session, setSession] = useState<Session | null>(null);
  const [name, setName] = useState('');
  const [mic, setMic] = useState(false);
  const [cam, setCam] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [hostKey, setHostKey] = useState<string | null>(null);

  useEffect(() => {
    setName(savedName());
    setHostKey(hostKeyFor(room.id));
  }, [room.id]);

  const options = useMemo<RoomOptions>(
    () => ({
      // Not adaptiveStream: it sizes the stream to the player on the page, which would send a
      // 1080p screen at 540p into a medium window. Quality is set per track instead (screen high,
      // camera tiles low), and the server still steps down when a viewer's connection can't keep up.
      adaptiveStream: false,
      dynacast: true,
      videoCaptureDefaults: { resolution: VideoPresets.h540.resolution },
      publishDefaults: { videoCodec: 'vp9', backupCodec: true },
    }),
    [],
  );

  async function join(e?: FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/rooms/${room.id}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, hostKey }),
      });
      if (res.status === 404) return setPhase('ended');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Could not join.');
      saveName(name.trim());
      setSession(data);
      setPhase('joined');
    } catch (err) {
      setError((err as Error).message === 'Failed to fetch' ? 'Could not reach the server.' : (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (phase === 'joined' && session) {
    return (
      <LiveKitRoom
        className="room-root"
        serverUrl={session.serverUrl}
        token={session.token}
        connect
        audio={mic}
        video={cam}
        options={options}
        onDisconnected={(reason) =>
          setPhase(
            reason === DisconnectReason.ROOM_DELETED
              ? 'ended'
              : reason === DisconnectReason.PARTICIPANT_REMOVED
                ? 'removed'
                : 'left',
          )
        }
        onError={(err) => setError(err.message)}
      >
        <RoomView info={session.room} role={session.role} hostKey={hostKey} />
        <RoomAudioRenderer />
      </LiveKitRoom>
    );
  }

  if (phase === 'left' || phase === 'removed' || phase === 'ended') {
    const copy = {
      left: { title: 'You left the room', body: 'The stream keeps going without you.' },
      removed: { title: 'You were removed', body: 'The host removed you from this room.' },
      ended: { title: 'This room has ended', body: 'The host ended it, or everyone left.' },
    }[phase];
    return (
      <div className="gate">
        <p className="eyebrow">beam</p>
        <h1 className="gate-title">{copy.title}</h1>
        <p className="muted">{copy.body}</p>
        <div className="gate-actions">
          {phase === 'left' && (
            <button className="btn primary" onClick={() => join()} disabled={busy}>
              Rejoin
            </button>
          )}
          <a className="btn" href="/">
            Back home
          </a>
        </div>
      </div>
    );
  }

  return (
    <form className="gate" onSubmit={join}>
      <p className="eyebrow">
        {room.visibility === 'public' ? <Icon name="globe" size={12} /> : <Icon name="lock" size={12} />}{' '}
        {room.visibility} room · hosted by {room.host}
      </p>
      <h1 className="gate-title">{room.title}</h1>
      {hostKey ? (
        <p className="muted">You're the host. Join, then press the screen button to go live.</p>
      ) : (
        <p className="muted">Pick a name and join. Your mic and camera stay off unless you turn them on.</p>
      )}

      <label className="field">
        <span className="label">your name</span>
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={32}
          required
          autoFocus
        />
      </label>

      <div className="gate-toggles">
        <button type="button" className="toggle" aria-pressed={mic} onClick={() => setMic(!mic)}>
          <Icon name={mic ? 'mic' : 'micOff'} size={16} /> {mic ? 'Mic on' : 'Mic off'}
        </button>
        <button type="button" className="toggle" aria-pressed={cam} onClick={() => setCam(!cam)}>
          <Icon name={cam ? 'camera' : 'cameraOff'} size={16} /> {cam ? 'Camera on' : 'Camera off'}
        </button>
      </div>

      <button className="btn primary join" disabled={busy || !name.trim()}>
        {busy ? 'Joining…' : 'Join room'}
      </button>
      {error && <p className="error">{error}</p>}
    </form>
  );
}

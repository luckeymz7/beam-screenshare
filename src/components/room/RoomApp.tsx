import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { LiveKitRoom, RoomAudioRenderer } from '@livekit/components-react';
import { DisconnectReason, VideoPresets, type RoomOptions } from 'livekit-client';
import { Icon } from '../Icon';
import { TContext, useT } from '../i18n';
import { hostKeyFor, saveHostKey, saveName, savedName } from '../../lib/client';
import { errorText, translator, type Lang } from '../../lib/i18n';
import type { Role, RoomInfo } from '../../lib/livekit';
import { RoomView } from './RoomView';

type Session = { token: string; serverUrl: string; role: Role; room: RoomInfo };
type Phase = 'prejoin' | 'joined' | 'left' | 'removed' | 'ended';

// Touch screens open the keyboard on autofocus, covering half the page
const touch = () => matchMedia('(pointer: coarse)').matches;

export default function RoomApp({ room, lang }: { room: RoomInfo; lang: Lang }) {
  const t = useMemo(() => translator(lang), [lang]);
  return (
    <TContext.Provider value={t}>
      <Room room={room} />
    </TContext.Provider>
  );
}

function Room({ room }: { room: RoomInfo }) {
  const t = useT();
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
    // A host link (#host=<key>) moves the host role to this device
    const fromLink = new URLSearchParams(location.hash.slice(1)).get('host');
    if (fromLink) {
      saveHostKey(room.id, fromLink);
      history.replaceState(null, '', location.pathname + location.search);
    }
    setHostKey(fromLink ?? hostKeyFor(room.id));
  }, [room.id]);

  const options = useMemo<RoomOptions>(
    () => ({
      // Not adaptiveStream: it sizes the stream to the player on the page, which would send a
      // 1080p screen at 540p into a medium window. Quality is set per track instead (screen high,
      // camera tiles low), and the server still steps down when a viewer's connection can't keep up.
      adaptiveStream: false,
      dynacast: true,
      // Cameras only fill small tiles. H.264 is encoded and decoded in hardware almost everywhere
      // (VP9 would run in software on an iPhone and heat it up); the screen share picks VP9 itself.
      videoCaptureDefaults: { resolution: VideoPresets.h360.resolution },
      publishDefaults: { videoCodec: 'h264', backupCodec: true },
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
      if (!res.ok) throw new Error(errorText(t, data, 'gate.joinFailed'));
      saveName(name.trim());
      setSession(data);
      setPhase('joined');
    } catch (err) {
      setError(err instanceof TypeError ? t('err.network') : (err as Error).message);
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
      left: { title: t('gate.left'), body: t('gate.leftBody') },
      removed: { title: t('gate.removed'), body: t('gate.removedBody') },
      ended: { title: t('page.ended'), body: t('gate.endedBody') },
    }[phase];
    return (
      <div className="gate">
        <p className="eyebrow">beam</p>
        <h1 className="gate-title">{copy.title}</h1>
        <p className="muted">{copy.body}</p>
        <div className="gate-actions">
          {phase === 'left' && (
            <button className="btn primary" onClick={() => join()} disabled={busy}>
              {t('gate.rejoin')}
            </button>
          )}
          <a className="btn" href="/">
            {t('page.backHome')}
          </a>
        </div>
      </div>
    );
  }

  return (
    <form className="gate" onSubmit={join}>
      <p className="eyebrow">
        <Icon name={room.visibility === 'public' ? 'globe' : 'lock'} size={12} />{' '}
        {room.visibility === 'public' ? t('gate.public') : t('gate.private')} · {t('gate.hostedBy', { host: room.host })}
      </p>
      <h1 className="gate-title">{room.title}</h1>
      <p className="muted">{hostKey ? t('gate.hostNote') : t('gate.guestNote')}</p>

      <label className="field">
        <span className="label">{t('create.name')}</span>
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={32}
          autoComplete="nickname"
          required
          autoFocus={!touch()}
        />
      </label>

      <div className="gate-toggles">
        <button type="button" className="toggle" aria-pressed={mic} onClick={() => setMic(!mic)}>
          <Icon name={mic ? 'mic' : 'micOff'} size={16} /> {mic ? t('gate.micOn') : t('gate.micOff')}
        </button>
        <button type="button" className="toggle" aria-pressed={cam} onClick={() => setCam(!cam)}>
          <Icon name={cam ? 'camera' : 'cameraOff'} size={16} /> {cam ? t('gate.camOn') : t('gate.camOff')}
        </button>
      </div>

      <button className="btn primary join" disabled={busy || !name.trim()}>
        {busy ? t('gate.joining') : t('gate.join')}
      </button>
      {error && <p className="error">{error}</p>}
    </form>
  );
}

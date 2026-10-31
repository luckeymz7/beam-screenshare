import { useEffect, useMemo, useState } from 'react';
import { RoomEvent, type Participant } from 'livekit-client';
import { useRoomContext } from '@livekit/components-react';
import { useT } from '../i18n';
import { metaOf } from './meta';
import type { Entrance } from '../../lib/themes';

const DURATION = 3200;
const CONFETTI = ['#ff5a5a', '#ffd166', '#5ee6a8', '#5ab8ff', '#c792ea', '#ffffff'];

/** One premium entrance: sparkles bursting, confetti falling, or a glow, around the name. */
export function EntranceEffect({ kind, name, accent }: { kind: Entrance; name: string; accent?: string }) {
  const t = useT();
  // Random once per effect, so re-renders don't reshuffle the pieces
  const pieces = useMemo(
    () =>
      kind === 'sparkles'
        ? Array.from({ length: 16 }, (_, i) => ({
            angle: (i / 16) * 360 + Math.random() * 12,
            dist: 70 + Math.random() * 70,
            delay: Math.random() * 0.25,
            size: 10 + Math.random() * 10,
          }))
        : kind === 'confetti'
          ? Array.from({ length: 48 }, () => ({
              left: Math.random() * 100,
              delay: Math.random() * 0.8,
              spin: Math.random() * 720 - 360,
              color: CONFETTI[Math.floor(Math.random() * CONFETTI.length)],
              drift: Math.random() * 60 - 30,
            }))
          : [],
    [kind],
  );

  return (
    <div className={`entrance entrance-${kind}`} style={accent ? ({ '--e-accent': accent } as React.CSSProperties) : undefined} aria-hidden="true">
      {kind === 'glow' && <span className="glow-ring" />}
      {kind === 'sparkles' &&
        pieces.map((p, i) => (
          <span
            key={i}
            className="spark"
            style={
              {
                '--angle': `${'angle' in p ? p.angle : 0}deg`,
                '--dist': `${'dist' in p ? p.dist : 0}px`,
                '--size': `${'size' in p ? p.size : 0}px`,
                animationDelay: `${p.delay}s`,
              } as React.CSSProperties
            }
          >
            ✦
          </span>
        ))}
      {kind === 'confetti' &&
        pieces.map((p, i) => (
          <span
            key={i}
            className="confetti-piece"
            style={
              {
                left: `${'left' in p ? p.left : 0}%`,
                background: 'color' in p ? p.color : undefined,
                '--spin': `${'spin' in p ? p.spin : 0}deg`,
                '--drift': `${'drift' in p ? p.drift : 0}px`,
                animationDelay: `${p.delay}s`,
              } as React.CSSProperties
            }
          />
        ))}
      <span className="entrance-name">
        <strong>✦ {name}</strong> {t('room.joined')}
      </span>
    </div>
  );
}

/** In a room: plays the entrance of each premium member who comes in, one after the other. */
export function Entrances() {
  const room = useRoomContext();
  const [queue, setQueue] = useState<{ id: number; kind: Entrance; name: string; accent?: string }[]>([]);

  useEffect(() => {
    const onJoin = (p: Participant) => {
      const meta = metaOf(p);
      if (!meta.premium || !meta.entrance) return;
      setQueue((q) => [...q.slice(-4), { id: Math.random(), kind: meta.entrance!, name: p.name || p.identity, accent: meta.theme?.accent }]);
    };
    room.on(RoomEvent.ParticipantConnected, onJoin);
    return () => {
      room.off(RoomEvent.ParticipantConnected, onJoin);
    };
  }, [room]);

  const current = queue[0];
  useEffect(() => {
    if (!current) return;
    const id = setTimeout(() => setQueue((q) => q.slice(1)), DURATION);
    return () => clearTimeout(id);
  }, [current?.id]);

  return current ? <EntranceEffect key={current.id} kind={current.kind} name={current.name} accent={current.accent} /> : null;
}

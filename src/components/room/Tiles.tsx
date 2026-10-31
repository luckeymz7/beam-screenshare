import { useEffect, useRef, useState } from 'react';
import { VideoTrack, isTrackReference, useIsMuted, useIsSpeaking, useParticipants, useTracks } from '@livekit/components-react';
import { RemoteTrackPublication, RoomEvent, Track, VideoQuality } from 'livekit-client';
import type { TrackReferenceOrPlaceholder } from '@livekit/components-react';
import { Icon } from '../Icon';
import { Avatar } from '../Account';
import { useT } from '../i18n';
import { metaOf } from './meta';
import { ProfileCard } from './ProfileCard';

/** Everyone in the room, under the stage: camera if on, their picture or initials otherwise. */
export function Tiles({
  isHost,
  onRemove,
  onMakeHost,
}: {
  isHost: boolean;
  onRemove: (identity: string) => void;
  onMakeHost: (identity: string) => void;
}) {
  const cameras = useTracks([{ source: Track.Source.Camera, withPlaceholder: true }]);
  // Roles (and the host badge) move when the host hands the room over
  useParticipants({ updateOnlyOn: [RoomEvent.ParticipantMetadataChanged] });
  const [open, setOpen] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  // The host first, then you, then everyone else in join order
  const sorted = [...cameras].sort(
    (a, b) =>
      Number(metaOf(b.participant).role === 'host') - Number(metaOf(a.participant).role === 'host') ||
      Number(b.participant.isLocal) - Number(a.participant.isLocal),
  );
  const opened = sorted.find((t) => t.participant.identity === open)?.participant;

  // The card closes on a click anywhere else
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(null);
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  return (
    <div className="tiles-wrap" ref={box}>
      <ul className="tiles">
        {sorted.map((t) => (
          <Tile
            key={t.participant.identity}
            trackRef={t}
            canRemove={isHost && !t.participant.isLocal}
            onRemove={onRemove}
            open={open === t.participant.identity}
            onOpen={(o) => setOpen(o ? t.participant.identity : null)}
          />
        ))}
      </ul>
      {/* Under the row rather than in the tile: the row scrolls sideways and would clip it */}
      {opened && (
        <div className="tile-card">
          <ProfileCard
            name={opened.name || opened.identity}
            meta={metaOf(opened)}
            you={opened.isLocal}
            friendButton
            onMakeHost={isHost && !opened.isLocal ? () => onMakeHost(opened.identity) : undefined}
            onClose={() => setOpen(null)}
          />
        </div>
      )}
    </div>
  );
}

function Tile({
  trackRef,
  canRemove,
  onRemove,
  open,
  onOpen,
}: {
  trackRef: TrackReferenceOrPlaceholder;
  canRemove: boolean;
  onRemove: (identity: string) => void;
  open: boolean;
  onOpen: (open: boolean) => void;
}) {
  const t = useT();
  const p = trackRef.participant;
  const meta = metaOf(p);
  const speaking = useIsSpeaking(p);
  const muted = useIsMuted({ participant: p, source: Track.Source.Microphone });
  const [armed, setArmed] = useState(false);
  const name = p.name || p.identity;
  const hasVideo = isTrackReference(trackRef) && !trackRef.publication.isMuted;

  // Tiles are small: the lowest camera layer is plenty. Nothing at all while the page is hidden.
  const pub = trackRef.publication;
  useEffect(() => {
    if (!(pub instanceof RemoteTrackPublication)) return;
    pub.setVideoQuality(VideoQuality.LOW);
    const onVisibility = () => pub.setEnabled(!document.hidden);
    onVisibility();
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [pub]);

  return (
    <li className={`tile ${speaking ? 'speaking' : ''} ${meta.premium ? 'premium' : ''} ${open ? 'open' : ''}`}>
      <button className="tile-open" onClick={() => onOpen(!open)} aria-label={name} aria-expanded={open} />
      {hasVideo ? (
        <VideoTrack trackRef={trackRef} className={`tile-video ${p.isLocal ? 'mirror' : ''}`} />
      ) : (
        <span className="avatar">
          <Avatar name={name} image={meta.image} size={48} />
        </span>
      )}
      <span className="tile-name">
        {muted && <Icon name="micOff" size={12} />}
        <span className="tile-label">{name}</span>
        {meta.premium && <span className="star" title="premium">✦</span>}
        {p.isLocal && <span className="you">{t('tile.you')}</span>}
        {meta.role === 'host' && <span className="host">{t('tile.host')}</span>}
      </span>
      {canRemove && (
        <button
          className={`tile-remove ${armed ? 'armed' : ''}`}
          onClick={() => (armed ? onRemove(p.identity) : setArmed(true))}
          onBlur={() => setArmed(false)}
          title={t('tile.remove')}
          aria-label={t('tile.remove')}
        >
          {armed ? t('tile.removeConfirm') : <Icon name="close" size={12} />}
        </button>
      )}
    </li>
  );
}

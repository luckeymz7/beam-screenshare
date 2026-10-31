import { useEffect, useState } from 'react';
import { VideoTrack, isTrackReference, useIsMuted, useIsSpeaking, useTracks } from '@livekit/components-react';
import { RemoteTrackPublication, Track, VideoQuality, type Participant } from 'livekit-client';
import type { TrackReferenceOrPlaceholder } from '@livekit/components-react';
import { Icon } from '../Icon';

const roleOf = (p: Participant) => {
  try {
    return (JSON.parse(p.metadata ?? '{}') as { role?: string }).role;
  } catch {
    return undefined;
  }
};

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase() || '?';

/** Everyone in the room, under the stage: camera if on, initials otherwise. */
export function Tiles({ isHost, onRemove }: { isHost: boolean; onRemove: (identity: string) => void }) {
  const cameras = useTracks([{ source: Track.Source.Camera, withPlaceholder: true }]);
  // The host first, then you, then everyone else in join order
  const sorted = [...cameras].sort(
    (a, b) =>
      Number(roleOf(b.participant) === 'host') - Number(roleOf(a.participant) === 'host') ||
      Number(b.participant.isLocal) - Number(a.participant.isLocal),
  );
  return (
    <ul className="tiles">
      {sorted.map((t) => (
        <Tile key={t.participant.identity} trackRef={t} canRemove={isHost && !t.participant.isLocal} onRemove={onRemove} />
      ))}
    </ul>
  );
}

function Tile({
  trackRef,
  canRemove,
  onRemove,
}: {
  trackRef: TrackReferenceOrPlaceholder;
  canRemove: boolean;
  onRemove: (identity: string) => void;
}) {
  const p = trackRef.participant;
  const speaking = useIsSpeaking(p);
  const muted = useIsMuted({ participant: p, source: Track.Source.Microphone });
  const [armed, setArmed] = useState(false);
  const name = p.name || p.identity;
  const hasVideo = isTrackReference(trackRef) && !trackRef.publication.isMuted;

  // Tiles are small: the lowest camera layer is plenty
  const pub = trackRef.publication;
  useEffect(() => {
    if (pub instanceof RemoteTrackPublication) pub.setVideoQuality(VideoQuality.LOW);
  }, [pub]);

  return (
    <li className={`tile ${speaking ? 'speaking' : ''}`}>
      {hasVideo ? (
        <VideoTrack trackRef={trackRef} className={`tile-video ${p.isLocal ? 'mirror' : ''}`} />
      ) : (
        <span className="avatar">{initials(name)}</span>
      )}
      <span className="tile-name">
        {muted && <Icon name="micOff" size={12} />}
        {name}
        {p.isLocal && <span className="you">you</span>}
        {roleOf(p) === 'host' && <span className="host">host</span>}
      </span>
      {canRemove && (
        <button
          className={`tile-remove ${armed ? 'armed' : ''}`}
          onClick={() => (armed ? onRemove(p.identity) : setArmed(true))}
          onBlur={() => setArmed(false)}
          title="Remove from the room"
        >
          {armed ? 'Remove?' : <Icon name="close" size={12} />}
        </button>
      )}
    </li>
  );
}

import { useState } from 'react';
import { Avatar } from '../Account';
import { FriendButton } from '../FriendButton';
import { Icon } from '../Icon';
import { useT } from '../i18n';
import { themeStyle } from '../../lib/themes';
import type { ParticipantMeta } from '../../lib/livekit';
import { setUserPref, useListen, userPref } from './listen';

/**
 * Someone's card, like Discord's: banner, avatar, name and bio. A premium theme tints it.
 * People who aren't logged in just have their name.
 */
export function ProfileCard({
  name,
  meta,
  you,
  onClose,
  friendButton,
  onMakeHost,
  listenKey,
}: {
  name: string;
  meta: Partial<ParticipantMeta>;
  you?: boolean;
  onClose?: () => void;
  /** Offer "Add friend" (someone else, with an account) */
  friendButton?: boolean;
  /** The host, looking at someone else: hand them the room */
  onMakeHost?: () => void;
  /** Someone else in the room: mute them or turn them down, for you only */
  listenKey?: string;
}) {
  const t = useT();
  const [armed, setArmed] = useState(false);
  const showFriend = friendButton && !you && !!meta.uid;
  return (
    <div className={`profile-card ${meta.theme ? 'themed' : ''}`} style={themeStyle(meta.theme)} role="dialog" aria-label={name}>
      <div className="pc-banner" style={meta.banner ? { backgroundImage: `url("${meta.banner}")` } : undefined} />
      <div className="pc-avatar">
        <Avatar name={name} image={meta.image} size={64} />
      </div>
      <div className="pc-body">
        <p className="pc-name">
          {name}
          {meta.premium && (
            <span className="premium-tag" title="premium">
              ✦ premium
            </span>
          )}
        </p>
        {/* host / guest only means something inside a room */}
        {meta.role && (
          <p className="pc-sub mono">
            {meta.role === 'host' ? t('tile.host') : t('profile.guest')}
            {you ? ` · ${t('tile.you')}` : ''}
            {!meta.uid ? ` · ${t('profile.noAccount')}` : ''}
          </p>
        )}
        {meta.bio && <p className="pc-bio">{meta.bio}</p>}
        {listenKey && <ListenControls listenKey={listenKey} />}
        {(showFriend || onMakeHost) && (
          <div className="pc-actions">
            {showFriend && <FriendButton userId={meta.uid!} />}
            {onMakeHost && (
              <button
                className={`btn friend-btn ${armed ? 'danger' : ''}`}
                onClick={() => (armed ? onMakeHost() : setArmed(true))}
                onBlur={() => setArmed(false)}
              >
                <Icon name="key" size={14} /> {armed ? t('room.makeHostConfirm', { name }) : t('room.makeHost')}
              </button>
            )}
          </div>
        )}
      </div>
      {onClose && (
        <button className="pc-close" onClick={onClose} aria-label={t('chat.close')}>
          ×
        </button>
      )}
    </div>
  );
}

/** Discord's "Mute" and "User volume": only in your browser, nobody else is affected. */
function ListenControls({ listenKey }: { listenKey: string }) {
  const t = useT();
  const pref = userPref(useListen(), listenKey);
  return (
    <div className="pc-listen">
      <button
        className={`btn friend-btn ${pref.muted ? 'danger' : ''}`}
        onClick={() => setUserPref(listenKey, { muted: !pref.muted })}
        aria-pressed={pref.muted}
      >
        <Icon name={pref.muted ? 'volumeOff' : 'volume'} size={14} /> {pref.muted ? t('listen.unmute') : t('listen.mute')}
      </button>
      <label className="pc-volume">
        <span className="mono">
          {t('listen.volume')} · {Math.round(pref.volume * 100)}%
        </span>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={Math.round(pref.volume * 100)}
          disabled={pref.muted}
          onChange={(e) => setUserPref(listenKey, { volume: Number(e.target.value) / 100 })}
          aria-label={t('listen.volume')}
        />
      </label>
      <p className="pc-note mono">{t('listen.onlyYou')}</p>
    </div>
  );
}

import { Avatar } from '../Account';
import { FriendButton } from '../FriendButton';
import { useT } from '../i18n';
import { themeStyle } from '../../lib/themes';
import type { ParticipantMeta } from '../../lib/livekit';

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
}: {
  name: string;
  meta: Partial<ParticipantMeta>;
  you?: boolean;
  onClose?: () => void;
  /** Offer "Add friend" (someone else, with an account) */
  friendButton?: boolean;
}) {
  const t = useT();
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
        {friendButton && !you && meta.uid && (
          <div className="pc-actions">
            <FriendButton userId={meta.uid} />
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

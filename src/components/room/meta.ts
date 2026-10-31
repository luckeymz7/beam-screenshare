import type { Participant } from 'livekit-client';
import type { ParticipantMeta } from '../../lib/livekit';
import { toEntrance, toTheme } from '../../lib/themes';

// Only pictures beam serves itself (or the login providers' avatars) end up in a profile
const safeImage = (v: unknown) => (typeof v === 'string' && /^(\/api\/img\/|https:\/\/)/.test(v) ? v : undefined);

/** A participant's server-signed metadata (role, and the profile of a logged-in person). */
export function metaOf(p: Participant | undefined): Partial<ParticipantMeta> {
  try {
    const m = JSON.parse(p?.metadata || '{}') as Partial<ParticipantMeta>;
    return {
      ...m,
      image: safeImage(m.image) ?? null,
      theme: toTheme(m.theme) ?? undefined,
      banner: safeImage(m.banner),
      entrance: toEntrance(m.entrance) ?? undefined,
    };
  } catch {
    return {};
  }
}

import type { Participant } from 'livekit-client';
import type { ParticipantMeta, Role, RoomInfo } from '../../lib/livekit';
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

/** A role from someone's metadata string (it changes when the host role moves). */
export function roleOf(metadata: string | undefined, fallback: Role): Role {
  try {
    const role = (JSON.parse(metadata || '{}') as { role?: unknown }).role;
    return role === 'host' || role === 'guest' ? role : fallback;
  } catch {
    return fallback;
  }
}

/**
 * The room as it is now. The host can change who may share and whether people knock, and hand
 * the room to someone else, during the room: LiveKit's room metadata carries the current values.
 */
export function liveRoom(base: RoomInfo, metadata: string | undefined): RoomInfo {
  try {
    const m = JSON.parse(metadata || '{}') as Record<string, unknown>;
    if (!m.hostKeyHash) return base;
    return {
      ...base,
      host: typeof m.host === 'string' ? m.host : base.host,
      approval: !!m.approval,
      share: !!m.share,
      max: typeof m.max === 'number' ? m.max : null,
      theme: toTheme(m.theme) ?? base.theme,
    };
  } catch {
    return base;
  }
}

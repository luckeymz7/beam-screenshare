import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { AccessToken, DataPacket_Kind, RoomServiceClient, TrackSource, type Room } from 'livekit-server-sdk';
import { LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_URL } from 'astro:env/server';
import { toTheme, type Theme } from './themes';
import type { RoomProfile } from './users';

// `bun run livekit` starts LiveKit in --dev mode with these credentials
const dev = import.meta.env.DEV;
const config = {
  url: LIVEKIT_URL ?? (dev ? 'ws://localhost:7880' : ''),
  key: LIVEKIT_API_KEY ?? (dev ? 'devkey' : ''),
  secret: LIVEKIT_API_SECRET ?? (dev ? 'secret' : ''),
};

let service: RoomServiceClient | undefined;
function rooms() {
  if (!config.url || !config.key || !config.secret) {
    throw new Error('Set LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET');
  }
  service ??= new RoomServiceClient(config.url.replace(/^ws/, 'http'), config.key, config.secret);
  return service;
}

export type Visibility = 'public' | 'private';

/** Stored as the LiveKit room's metadata, which every participant can read: never the host key itself. */
type RoomMeta = {
  title: string;
  visibility: Visibility;
  host: string;
  hostKeyHash: string;
  createdAt: number;
  /** Private rooms only: the host lets each person in */
  approval?: boolean;
  /** The host's premium theme */
  theme?: Theme;
  /** The host's account, when logged in */
  hostUser?: string;
  /** Most people allowed in at once (the host included) */
  max?: number;
  /** Everyone may share their screen, not only the host (like Google Meet's "Share their screen") */
  share?: boolean;
};

export type RoomInfo = {
  id: string;
  title: string;
  visibility: Visibility;
  host: string;
  createdAt: number;
  participants: number;
  approval: boolean;
  theme: Theme | null;
  max: number | null;
  share: boolean;
};

export const MAX_PARTICIPANTS = 100;
export const roomSizes = [2, 5, 10, 25, 50] as const;

const ID = /^[A-Za-z0-9]{10}$/;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

/** Unguessable, so a private room is only reachable through its link. */
function newId() {
  return Array.from(randomBytes(10), (b) => ALPHABET[b % ALPHABET.length]).join('');
}

const hash = (s: string) => createHash('sha256').update(s).digest();

function parseMeta(room: Room): RoomMeta | null {
  try {
    const meta = JSON.parse(room.metadata) as RoomMeta;
    return meta.hostKeyHash ? meta : null;
  } catch {
    return null; // rooms not created by beam
  }
}

const toInfo = (room: Room, meta: RoomMeta): RoomInfo => ({
  id: room.name,
  title: meta.title,
  visibility: meta.visibility,
  host: meta.host,
  createdAt: meta.createdAt,
  participants: room.numParticipants,
  approval: !!meta.approval,
  theme: toTheme(meta.theme),
  max: meta.max ?? null,
  share: !!meta.share,
});

export async function createRoom(input: {
  title: string;
  visibility: Visibility;
  host: string;
  approval?: boolean;
  theme?: Theme | null;
  hostUser?: string | null;
  max?: number | null;
  share?: boolean;
}) {
  const id = newId();
  const hostKey = randomBytes(24).toString('base64url');
  const meta: RoomMeta = {
    title: input.title,
    visibility: input.visibility,
    host: input.host,
    hostKeyHash: hash(hostKey).toString('hex'),
    createdAt: Date.now(),
    ...(input.visibility === 'private' && input.approval ? { approval: true } : {}),
    ...(input.theme ? { theme: input.theme } : {}),
    ...(input.hostUser ? { hostUser: input.hostUser } : {}),
    ...(input.max ? { max: input.max } : {}),
    ...(input.share ? { share: true } : {}),
  };
  await rooms().createRoom({
    name: id,
    // An empty room ends: 20 seconds after the last person leaves (enough to survive a reload or
    // a dropped connection), or after 2 minutes if nobody ever came in
    emptyTimeout: 2 * 60,
    departureTimeout: 20,
    // LiveKit refuses anyone past the limit; the token endpoint says "full" before it comes to that
    maxParticipants: input.max ?? MAX_PARTICIPANTS,
    metadata: JSON.stringify(meta),
  });
  return { id, hostKey };
}

export async function getRoom(id: string) {
  if (!ID.test(id)) return null;
  const [room] = await rooms().listRooms([id]);
  const meta = room && parseMeta(room);
  return meta ? { info: toInfo(room, meta), meta } : null;
}

export async function publicRooms(): Promise<RoomInfo[]> {
  const list = await rooms().listRooms();
  return list
    .map((room) => [room, parseMeta(room)] as const)
    .filter((entry): entry is readonly [Room, RoomMeta] => entry[1]?.visibility === 'public')
    .map(([room, meta]) => toInfo(room, meta))
    // An empty room is on its way out; a brand-new one is waiting for its creator to come in
    .filter((r) => r.participants > 0 || Date.now() - r.createdAt < 60_000)
    .sort((a, b) => b.participants - a.participants || b.createdAt - a.createdAt);
}

export function isHost(meta: RoomMeta, hostKey: string | null | undefined) {
  if (!hostKey) return false;
  return timingSafeEqual(hash(hostKey), Buffer.from(meta.hostKeyHash, 'hex'));
}

export type Role = 'host' | 'guest';

/** Everyone in the room can read it; only the server can write it (it's signed into the token). */
export type ParticipantMeta = { role: Role } & Partial<RoomProfile>;

/**
 * What someone may publish. Everyone can talk and turn on their camera; the screen is the host's,
 * unless the host lets everyone share.
 */
const sourcesFor = (role: Role, guestsShare: boolean) =>
  role === 'host' || guestsShare
    ? [TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO, TrackSource.CAMERA, TrackSource.MICROPHONE]
    : [TrackSource.CAMERA, TrackSource.MICROPHONE];

/** The full permission set (LiveKit replaces permissions as a whole, never field by field). */
const permissionFor = (role: Role, guestsShare: boolean) => ({
  canSubscribe: true,
  canPublish: true,
  canPublishData: true,
  canPublishSources: sourcesFor(role, guestsShare),
  canUpdateMetadata: false,
});

export async function joinToken(
  roomId: string,
  name: string,
  role: Role,
  profile?: RoomProfile | null,
  guestsShare = false,
) {
  const metadata: ParticipantMeta = { role, ...profile };
  const token = new AccessToken(config.key, config.secret, {
    identity: `p_${randomBytes(6).toString('base64url')}`,
    name,
    ttl: '8h',
    metadata: JSON.stringify(metadata),
  });
  // No roomAdmin: moderation goes through beam's API (checked against the host key), so a token
  // never carries more power than its holder has right now, even after the host role moves on
  token.addGrant({
    room: roomId,
    roomJoin: true,
    canSubscribe: true,
    canPublishData: true,
    canPublishSources: sourcesFor(role, guestsShare),
  });
  return { token: await token.toJwt(), serverUrl: config.url };
}

/** Host actions; the caller has already checked the host key. */
export const removeFromRoom = (roomId: string, identity: string) => rooms().removeParticipant(roomId, identity);
export const endRoom = (roomId: string) => rooms().deleteRoom(roomId);

const readMeta = (metadata: string): Partial<ParticipantMeta> => {
  try {
    return JSON.parse(metadata || '{}');
  } catch {
    return {};
  }
};

/** Host settings that can change during the room: who may share, and asking before letting in. */
export async function updateSettings(roomId: string, meta: RoomMeta, change: { share?: boolean; approval?: boolean }) {
  const next: RoomMeta = { ...meta };
  if (change.share !== undefined) next.share = change.share;
  // Only private rooms can ask first (a public room is listed for anyone to walk in)
  if (change.approval !== undefined && meta.visibility === 'private') next.approval = change.approval;
  await rooms().updateRoomMetadata(roomId, JSON.stringify(next));

  // Give (or take back) the screen to everyone already in the room. Taking it back stops their share.
  if (change.share !== undefined && change.share !== !!meta.share) {
    const people = await rooms().listParticipants(roomId);
    await Promise.all(
      people
        .filter((p) => readMeta(p.metadata).role !== 'host')
        .map((p) => rooms().updateParticipant(roomId, p.identity, { permission: permissionFor('guest', change.share!) })),
    );
  }
  return next;
}

/**
 * Hands the room to someone else in it: a new host key (so the old one stops working), the role
 * and permissions swapped, and the new key delivered to the new host's browser only, from the
 * server (a data message no participant can fake, since it has no sender).
 */
export async function transferHost(roomId: string, meta: RoomMeta, identity: string) {
  const target = await rooms().getParticipant(roomId, identity);
  const hostKey = randomBytes(24).toString('base64url');
  const targetMeta = readMeta(target.metadata);
  await rooms().updateRoomMetadata(
    roomId,
    JSON.stringify({
      ...meta,
      host: target.name || meta.host,
      hostKeyHash: hash(hostKey).toString('hex'),
      hostUser: targetMeta.uid,
    } satisfies RoomMeta),
  );

  const people = await rooms().listParticipants(roomId);
  await Promise.all(
    people.map((p) => {
      const pm = readMeta(p.metadata);
      const role: Role = p.identity === identity ? 'host' : 'guest';
      if (pm.role === role) return null;
      return rooms().updateParticipant(roomId, p.identity, {
        metadata: JSON.stringify({ ...pm, role }),
        permission: permissionFor(role, !!meta.share),
      });
    }),
  );
  await rooms().sendData(roomId, new TextEncoder().encode(JSON.stringify({ hostKey })), DataPacket_Kind.RELIABLE, {
    destinationIdentities: [identity],
    topic: 'host-key',
  });
}

export type LiveParticipant = {
  identity: string;
  name: string;
  role: Role;
  userId: string | null;
  premium: boolean;
  joinedAt: number;
  /** The shared screen's size, when this person is sharing */
  sharing: { width: number; height: number; sound: boolean } | null;
};

/** Admin: every beam room, public and private, with who is in it and who is sharing. */
export async function liveRooms() {
  const list = await rooms().listRooms();
  const beam = list
    .map((room) => [room, parseMeta(room)] as const)
    .filter((entry): entry is readonly [Room, RoomMeta] => !!entry[1]);
  return Promise.all(
    beam.map(async ([room, meta]) => {
      const people = await rooms().listParticipants(room.name);
      const participants: LiveParticipant[] = people.map((p) => {
        let pm: Partial<ParticipantMeta> = {};
        try {
          pm = JSON.parse(p.metadata || '{}');
        } catch {}
        const screen = p.tracks.find((t) => t.source === TrackSource.SCREEN_SHARE);
        const sound = p.tracks.some((t) => t.source === TrackSource.SCREEN_SHARE_AUDIO);
        return {
          identity: p.identity,
          name: p.name || p.identity,
          role: pm.role === 'host' ? 'host' : 'guest',
          userId: pm.uid ?? null,
          premium: !!pm.premium,
          joinedAt: Number(p.joinedAt) * 1000,
          sharing: screen ? { width: screen.width, height: screen.height, sound } : null,
        };
      });
      return { ...toInfo(room, meta), hostUser: meta.hostUser ?? null, participants };
    }),
  );
}
export type LiveRoom = Awaited<ReturnType<typeof liveRooms>>[number];

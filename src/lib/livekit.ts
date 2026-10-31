import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { AccessToken, RoomServiceClient, TrackSource, type Room } from 'livekit-server-sdk';
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
};

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
});

export async function createRoom(input: {
  title: string;
  visibility: Visibility;
  host: string;
  approval?: boolean;
  theme?: Theme | null;
  hostUser?: string | null;
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
  };
  await rooms().createRoom({
    name: id,
    // An empty room ends: 20 seconds after the last person leaves (enough to survive a reload or
    // a dropped connection), or after 2 minutes if nobody ever came in
    emptyTimeout: 2 * 60,
    departureTimeout: 20,
    maxParticipants: 100,
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

export async function joinToken(roomId: string, name: string, role: Role, profile?: RoomProfile | null) {
  const metadata: ParticipantMeta = { role, ...profile };
  const token = new AccessToken(config.key, config.secret, {
    identity: `${role === 'host' ? 'h' : 'g'}_${randomBytes(6).toString('base64url')}`,
    name,
    ttl: '8h',
    metadata: JSON.stringify(metadata),
  });
  token.addGrant({
    room: roomId,
    roomJoin: true,
    canSubscribe: true,
    canPublishData: true,
    // Only the host can share the screen; everyone can talk and turn on their camera
    canPublishSources:
      role === 'host'
        ? [TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO, TrackSource.CAMERA, TrackSource.MICROPHONE]
        : [TrackSource.CAMERA, TrackSource.MICROPHONE],
    roomAdmin: role === 'host',
  });
  return { token: await token.toJwt(), serverUrl: config.url };
}

/** Host actions; the caller has already checked the host key. */
export const removeFromRoom = (roomId: string, identity: string) => rooms().removeParticipant(roomId, identity);
export const endRoom = (roomId: string) => rooms().deleteRoom(roomId);

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

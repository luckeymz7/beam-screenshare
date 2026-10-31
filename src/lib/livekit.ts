import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { AccessToken, RoomServiceClient, TrackSource, type Room } from 'livekit-server-sdk';
import { LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_URL } from 'astro:env/server';

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
type RoomMeta = { title: string; visibility: Visibility; host: string; hostKeyHash: string; createdAt: number };

export type RoomInfo = {
  id: string;
  title: string;
  visibility: Visibility;
  host: string;
  createdAt: number;
  participants: number;
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
});

export async function createRoom(input: { title: string; visibility: Visibility; host: string }) {
  const id = newId();
  const hostKey = randomBytes(24).toString('base64url');
  const meta: RoomMeta = { ...input, hostKeyHash: hash(hostKey).toString('hex'), createdAt: Date.now() };
  await rooms().createRoom({
    name: id,
    // Closes if nobody joins within 10 minutes, and 2 minutes after the last person leaves
    emptyTimeout: 10 * 60,
    departureTimeout: 2 * 60,
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
    .sort((a, b) => b.participants - a.participants || b.createdAt - a.createdAt);
}

export function isHost(meta: RoomMeta, hostKey: string | null | undefined) {
  if (!hostKey) return false;
  return timingSafeEqual(hash(hostKey), Buffer.from(meta.hostKeyHash, 'hex'));
}

export type Role = 'host' | 'guest';

export async function joinToken(roomId: string, name: string, role: Role) {
  const token = new AccessToken(config.key, config.secret, {
    identity: `${role === 'host' ? 'h' : 'g'}_${randomBytes(6).toString('base64url')}`,
    name,
    ttl: '8h',
    metadata: JSON.stringify({ role }),
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

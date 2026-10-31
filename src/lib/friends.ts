import { randomBytes } from 'node:crypto';
import { and, count, eq, inArray, ne, or } from 'drizzle-orm';
import { db, ensureDb, schema } from './db';
import { liveRooms, type LiveRoom } from './livekit';
import { parseTheme, type Theme } from './themes';

// Friends: a request one way, accepted the other. What it gives you: seeing when your friends
// are live, and getting into their rooms.

/** A pair is stored once, smallest id first. */
const pair = (a: string, b: string) => (a < b ? { userA: a, userB: b } : { userA: b, userB: a });
const samePair = (a: string, b: string) => {
  const p = pair(a, b);
  return and(eq(schema.friendships.userA, p.userA), eq(schema.friendships.userB, p.userB));
};

export type Relation = 'self' | 'none' | 'friends' | 'outgoing' | 'incoming';

export async function relation(me: string, other: string): Promise<Relation> {
  if (me === other) return 'self';
  await ensureDb();
  const [row] = await db.select().from(schema.friendships).where(samePair(me, other));
  if (!row) return 'none';
  if (row.status === 'accepted') return 'friends';
  return row.requestedBy === me ? 'outgoing' : 'incoming';
}

const MAX_PENDING = 100;

/** Asks to be friends. If they had already asked you, you're friends now. */
export async function addFriend(me: string, other: string): Promise<Relation> {
  const current = await relation(me, other);
  if (current === 'self' || current === 'friends' || current === 'outgoing') return current;
  if (current === 'incoming') return acceptFriend(me, other);
  const [exists] = await db.select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.id, other));
  if (!exists) return 'none';
  const [pending] = await db
    .select({ n: count() })
    .from(schema.friendships)
    .where(and(eq(schema.friendships.requestedBy, me), eq(schema.friendships.status, 'pending')));
  if (pending.n >= MAX_PENDING) return 'none';
  await db
    .insert(schema.friendships)
    .values({ ...pair(me, other), requestedBy: me, status: 'pending', createdAt: new Date() })
    .onConflictDoNothing();
  return 'outgoing';
}

export async function acceptFriend(me: string, other: string): Promise<Relation> {
  await ensureDb();
  await db
    .update(schema.friendships)
    .set({ status: 'accepted' })
    .where(and(samePair(me, other), eq(schema.friendships.requestedBy, other), eq(schema.friendships.status, 'pending')));
  return relation(me, other);
}

/** Unfriend, decline a request, or take back your own. */
export async function removeFriend(me: string, other: string) {
  await ensureDb();
  await db.delete(schema.friendships).where(samePair(me, other));
}

export async function incomingCount(me: string) {
  await ensureDb();
  const [row] = await db
    .select({ n: count() })
    .from(schema.friendships)
    .where(
      and(
        or(eq(schema.friendships.userA, me), eq(schema.friendships.userB, me)),
        eq(schema.friendships.status, 'pending'),
        // pending and not asked by me = waiting for my answer
        ne(schema.friendships.requestedBy, me),
      ),
    );
  return row.n;
}

// ---------- friend links ----------

const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

export async function friendCode(userId: string) {
  await ensureDb();
  const [row] = await db.select().from(schema.friendCodes).where(eq(schema.friendCodes.userId, userId));
  if (row) return row.code;
  const code = Array.from(randomBytes(8), (b) => ALPHABET[b % ALPHABET.length]).join('');
  await db.insert(schema.friendCodes).values({ userId, code }).onConflictDoNothing();
  const [saved] = await db.select().from(schema.friendCodes).where(eq(schema.friendCodes.userId, userId));
  return saved.code;
}

export async function userByCode(code: string) {
  if (!/^[a-z0-9]{6,16}$/.test(code)) return null;
  await ensureDb();
  const [row] = await db
    .select({ id: schema.user.id, name: schema.user.name, image: schema.user.image })
    .from(schema.friendCodes)
    .innerJoin(schema.user, eq(schema.user.id, schema.friendCodes.userId))
    .where(eq(schema.friendCodes.code, code));
  if (!row) return null;
  return { ...row, ...(await cards([row.id])).get(row.id) };
}

// ---------- lists ----------

/** Bio, premium and theme for a few people, for their cards. */
async function cards(ids: string[]) {
  const out = new Map<string, { bio: string; premium: boolean; theme: Theme | null; banner: string | null }>();
  if (ids.length === 0) return out;
  const [profiles, subs] = await Promise.all([
    db.select().from(schema.profiles).where(inArray(schema.profiles.userId, ids)),
    db.select().from(schema.subscriptions).where(inArray(schema.subscriptions.userId, ids)),
  ]);
  const premiumIds = new Set(subs.filter((s) => (s.premiumUntil?.getTime() ?? 0) > Date.now()).map((s) => s.userId));
  for (const id of ids) {
    const p = profiles.find((x) => x.userId === id);
    const premium = premiumIds.has(id);
    out.set(id, { bio: p?.bio ?? '', premium, theme: premium ? parseTheme(p?.theme) : null, banner: premium ? (p?.banner ?? null) : null });
  }
  return out;
}

export type FriendLive = { room: string | null; title: string | null; hosting: boolean };
export type Friend = {
  id: string;
  name: string;
  image: string | null;
  bio: string;
  premium: boolean;
  theme: Theme | null;
  banner: string | null;
  live: FriendLive | null;
};

// Every logged-in page asks LiveKit who is where; share one answer for a few seconds
let liveCache: { at: number; rooms: Promise<LiveRoom[]> } | undefined;
const live = () => {
  if (!liveCache || Date.now() - liveCache.at > 15_000) {
    liveCache = { at: Date.now(), rooms: liveRooms().catch(() => []) };
  }
  return liveCache.rooms;
};

/**
 * Where each of these people is live. A public room, or a private one that asks first (you'd
 * knock), can be joined from the list; any other private room only shows that they're busy.
 */
async function presence(ids: string[]) {
  const where = new Map<string, FriendLive>();
  if (ids.length === 0) return where;
  const wanted = new Set(ids);
  for (const room of await live()) {
    const open = room.visibility === 'public' || room.approval;
    for (const p of room.participants) {
      if (!p.userId || !wanted.has(p.userId)) continue;
      const entry = { room: open ? room.id : null, title: open ? room.title : null, hosting: p.role === 'host' };
      // Hosting wins over just watching
      if (!where.has(p.userId) || entry.hosting) where.set(p.userId, entry);
    }
  }
  return where;
}

export async function listFriends(me: string) {
  await ensureDb();
  const rows = await db
    .select()
    .from(schema.friendships)
    .where(or(eq(schema.friendships.userA, me), eq(schema.friendships.userB, me)));
  const other = (r: (typeof rows)[number]) => (r.userA === me ? r.userB : r.userA);
  const ids = rows.map(other);
  if (ids.length === 0) return { friends: [] as Friend[], incoming: [] as Friend[], outgoing: [] as Friend[] };

  const accepted = rows.filter((r) => r.status === 'accepted').map(other);
  const [people, extra, where] = await Promise.all([
    db
      .select({ id: schema.user.id, name: schema.user.name, image: schema.user.image })
      .from(schema.user)
      .where(inArray(schema.user.id, ids)),
    cards(ids),
    presence(accepted),
  ]);
  const toFriend = (id: string): Friend | null => {
    const p = people.find((x) => x.id === id);
    if (!p) return null;
    const e = extra.get(id)!;
    return { id, name: p.name, image: p.image ?? null, ...e, live: where.get(id) ?? null };
  };
  const pick = (filter: (r: (typeof rows)[number]) => boolean) =>
    rows
      .filter(filter)
      .map((r) => toFriend(other(r)))
      .filter((f): f is Friend => !!f);

  const friends = pick((r) => r.status === 'accepted').sort(
    (a, b) => Number(!!b.live) - Number(!!a.live) || a.name.localeCompare(b.name),
  );
  return {
    friends,
    incoming: pick((r) => r.status === 'pending' && r.requestedBy !== me),
    outgoing: pick((r) => r.status === 'pending' && r.requestedBy === me),
  };
}

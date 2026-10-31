import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, asc, eq, gt, lt } from 'drizzle-orm';
import { db, ensureDb, schema } from './db';

// Private rooms can ask the host before letting someone in. The guest's browser keeps a
// secret for its request (only the hash is stored) and polls until the host decides.

const PENDING_FOR = 10 * 60_000;
/** An accepted request lets that browser rejoin for a while (reloads, dropped connections). */
const ACCEPTED_FOR = 8 * 3_600_000;

const hash = (s: string) => createHash('sha256').update(s).digest('hex');

export async function createRequest(room: string, who: { name: string; image?: string | null; userId?: string | null }) {
  await ensureDb();
  const id = randomBytes(9).toString('base64url');
  const secret = randomBytes(24).toString('base64url');
  const now = Date.now();
  await db.batch([
    db.delete(schema.joinRequests).where(lt(schema.joinRequests.createdAt, new Date(now - ACCEPTED_FOR))),
    db.insert(schema.joinRequests).values({
      id,
      room,
      name: who.name,
      image: who.image ?? null,
      userId: who.userId ?? null,
      secretHash: hash(secret),
      status: 'pending',
      createdAt: new Date(now),
    }),
  ]);
  return { id, secret };
}

export type RequestState = 'pending' | 'accepted' | 'denied' | 'expired';

/** Where this browser's request stands, or null if the id/secret don't match this room. */
export async function requestState(room: string, id: string, secret: string): Promise<RequestState | null> {
  await ensureDb();
  const [row] = await db
    .select()
    .from(schema.joinRequests)
    .where(and(eq(schema.joinRequests.id, id), eq(schema.joinRequests.room, room)));
  if (!row) return null;
  const a = Buffer.from(row.secretHash, 'hex');
  const b = Buffer.from(hash(secret), 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const age = Date.now() - row.createdAt.getTime();
  if (row.status === 'pending' && age > PENDING_FOR) return 'expired';
  if (row.status === 'accepted' && age > ACCEPTED_FOR) return 'expired';
  return row.status as RequestState;
}

/** Who is waiting at the door, oldest first. */
export async function pendingRequests(room: string) {
  await ensureDb();
  return db
    .select({ id: schema.joinRequests.id, name: schema.joinRequests.name, image: schema.joinRequests.image })
    .from(schema.joinRequests)
    .where(
      and(
        eq(schema.joinRequests.room, room),
        eq(schema.joinRequests.status, 'pending'),
        gt(schema.joinRequests.createdAt, new Date(Date.now() - PENDING_FOR)),
      ),
    )
    .orderBy(asc(schema.joinRequests.createdAt))
    .limit(20);
}

export async function decideRequest(room: string, id: string, accept: boolean) {
  await ensureDb();
  await db
    .update(schema.joinRequests)
    .set({ status: accept ? 'accepted' : 'denied' })
    .where(and(eq(schema.joinRequests.id, id), eq(schema.joinRequests.room, room), eq(schema.joinRequests.status, 'pending')));
}

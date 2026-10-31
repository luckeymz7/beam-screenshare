import { and, count, desc, eq, gte, sql } from 'drizzle-orm';
import { db, ensureDb, schema } from './db';

export type EventType = 'room' | 'join' | 'share' | 'signup' | 'premium';
export const eventTypes: EventType[] = ['room', 'join', 'share', 'signup', 'premium'];

const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Counts something for the admin dashboard. Never fails the request it's part of. */
export async function track(type: EventType, data: { room?: string; userId?: string | null } = {}) {
  try {
    await ensureDb();
    const at = Date.now();
    await db.insert(schema.events).values({ type, day: dayOf(at), at: new Date(at), room: data.room, userId: data.userId ?? null });
  } catch (e) {
    console.error('track:', (e as Error).message);
  }
}

export type Series = { day: string; counts: Record<EventType, number> }[];

/** Daily counts of every event type over the last `days` days (UTC), zero-filled. */
export async function eventSeries(days: number): Promise<Series> {
  await ensureDb();
  const start = Date.now() - (days - 1) * 86_400_000;
  const rows = await db
    .select({ day: schema.events.day, type: schema.events.type, n: count() })
    .from(schema.events)
    .where(gte(schema.events.day, dayOf(start)))
    .groupBy(schema.events.day, schema.events.type);
  const series: Series = Array.from({ length: days }, (_, i) => ({
    day: dayOf(start + i * 86_400_000),
    counts: { room: 0, join: 0, share: 0, signup: 0, premium: 0 },
  }));
  const byDay = new Map(series.map((s) => [s.day, s]));
  for (const r of rows) {
    const point = byDay.get(r.day);
    if (point && r.type in point.counts) point.counts[r.type as EventType] = r.n;
  }
  return series;
}

export async function totals() {
  await ensureDb();
  const now = new Date();
  const monthAgo = new Date(Date.now() - 30 * 86_400_000);
  const [[users], [premium], [revenue], recentPayments] = await Promise.all([
    db.select({ n: count() }).from(schema.user),
    db
      .select({ n: count() })
      .from(schema.subscriptions)
      .where(and(gte(schema.subscriptions.premiumUntil, now), sql`${schema.subscriptions.status} != 'granted'`)),
    db
      .select({ amount: sql<number>`coalesce(sum(${schema.payments.amount}), 0)`, fee: sql<number>`coalesce(sum(${schema.payments.fee}), 0)` })
      // refunds are stored as negative amounts
      .from(schema.payments)
      .where(gte(schema.payments.at, monthAgo)),
    db
      .select({
        id: schema.payments.id,
        amount: schema.payments.amount,
        fee: schema.payments.fee,
        method: schema.payments.method,
        event: schema.payments.event,
        at: schema.payments.at,
        name: schema.user.name,
        email: schema.user.email,
      })
      .from(schema.payments)
      .leftJoin(schema.user, eq(schema.user.id, schema.payments.userId))
      .orderBy(desc(schema.payments.at))
      .limit(20),
  ]);
  return {
    users: users.n,
    paying: premium.n,
    revenue30: Number(revenue.amount),
    fees30: Number(revenue.fee),
    recentPayments,
  };
}

import type { APIRoute } from 'astro';
import { desc, eq, like, or } from 'drizzle-orm';
import { db, ensureDb, schema } from '../../../lib/db';
import { grantPremium } from '../../../lib/users';

/** Admin: newest accounts (or a search) with their premium state. */
export const GET: APIRoute = async ({ url }) => {
  await ensureDb();
  const q = (url.searchParams.get('q') ?? '').trim().slice(0, 80);
  const rows = await db
    .select({
      id: schema.user.id,
      name: schema.user.name,
      email: schema.user.email,
      image: schema.user.image,
      createdAt: schema.user.createdAt,
      status: schema.subscriptions.status,
      premiumUntil: schema.subscriptions.premiumUntil,
    })
    .from(schema.user)
    .leftJoin(schema.subscriptions, eq(schema.subscriptions.userId, schema.user.id))
    .where(q ? or(like(schema.user.name, `%${q}%`), like(schema.user.email, `%${q}%`)) : undefined)
    .orderBy(desc(schema.user.createdAt))
    .limit(100);
  return Response.json({ users: rows }, { headers: { 'Cache-Control': 'no-store' } });
};

/** Admin: { userId, days } gives premium for that many days; days 0 takes it away. */
export const POST: APIRoute = async ({ request }) => {
  const body = (await request.json().catch(() => ({}))) as { userId?: unknown; days?: unknown };
  const days = Number(body.days);
  if (typeof body.userId !== 'string' || !Number.isFinite(days) || days < 0 || days > 3650) {
    return Response.json({ error: 'Bad request' }, { status: 400 });
  }
  await grantPremium(body.userId, days);
  return new Response(null, { status: 204 });
};

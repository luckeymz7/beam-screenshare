import type { APIRoute } from 'astro';
import { acceptFriend, addFriend, friendCode, listFriends, relation, removeFriend, userByCode } from '../../lib/friends';

const unauthorized = () => Response.json({ error: 'Log in first' }, { status: 401 });

/** GET: your friends, requests and friend code. GET ?with=<id>: where you stand with one person. */
export const GET: APIRoute = async ({ locals, url }) => {
  const me = locals.user;
  const other = url.searchParams.get('with');
  if (other) return Response.json({ relation: me ? await relation(me.id, other) : 'anonymous' });
  if (!me) return unauthorized();
  const [lists, code] = await Promise.all([listFriends(me.id), friendCode(me.id)]);
  return Response.json({ ...lists, code }, { headers: { 'Cache-Control': 'no-store' } });
};

/** POST { action: add | accept | remove, id } or { action: add, code } */
export const POST: APIRoute = async ({ locals, request }) => {
  const me = locals.user;
  if (!me) return unauthorized();
  const body = (await request.json().catch(() => ({}))) as { action?: unknown; id?: unknown; code?: unknown };
  let other = typeof body.id === 'string' ? body.id : '';
  if (!other && typeof body.code === 'string') other = (await userByCode(body.code.trim().toLowerCase()))?.id ?? '';
  if (!other) return Response.json({ error: 'Not found', code: 'notFound' }, { status: 404 });

  if (body.action === 'add') return Response.json({ relation: await addFriend(me.id, other) });
  if (body.action === 'accept') return Response.json({ relation: await acceptFriend(me.id, other) });
  if (body.action === 'remove') {
    await removeFriend(me.id, other);
    return Response.json({ relation: 'none' });
  }
  return Response.json({ error: 'Unknown action' }, { status: 400 });
};

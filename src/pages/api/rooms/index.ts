import type { APIRoute } from 'astro';
import { createRoom } from '../../../lib/livekit';
import { listRooms } from '../../../lib/rooms';
import { allowCreate } from '../../../lib/thumbs';
import { apiError, unreachable } from '../../../lib/http';
import { getMe } from '../../../lib/users';
import { track } from '../../../lib/events';

export const GET: APIRoute = async () => {
  try {
    return Response.json({ rooms: await listRooms() }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return unreachable(e);
  }
};

const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');

export const POST: APIRoute = async ({ request, clientAddress, locals }) => {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const title = clean(body.title, 60);
  const host = clean(body.name, 32);
  const visibility = body.visibility === 'private' ? 'private' : 'public';
  if (!title || !host) return apiError('required', 'A room title and your name are required.', 400);
  if (!(await allowCreate(clientAddress))) return apiError('limit', 'Too many new rooms. Try again in a few minutes.', 429);
  // A premium host's rooms wear their theme
  const me = await getMe(locals.user).catch(() => null);
  try {
    const room = await createRoom({
      title,
      host,
      visibility,
      approval: body.approval === true,
      theme: me?.theme,
      hostUser: me?.id,
    });
    await track('room', { room: room.id, userId: me?.id });
    return Response.json(room, { status: 201 });
  } catch (e) {
    return unreachable(e);
  }
};

import type { APIRoute } from 'astro';
import { createRoom } from '../../../lib/livekit';
import { listRooms } from '../../../lib/rooms';
import { allowCreate } from '../../../lib/db';
import { apiError, unreachable } from '../../../lib/http';

export const GET: APIRoute = async () => {
  try {
    return Response.json({ rooms: await listRooms() }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return unreachable(e);
  }
};

const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');

export const POST: APIRoute = async ({ request, clientAddress }) => {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const title = clean(body.title, 60);
  const host = clean(body.name, 32);
  const visibility = body.visibility === 'private' ? 'private' : 'public';
  if (!title || !host) return apiError('required', 'A room title and your name are required.', 400);
  if (!(await allowCreate(clientAddress))) return apiError('limit', 'Too many new rooms. Try again in a few minutes.', 429);
  try {
    return Response.json(await createRoom({ title, host, visibility }), { status: 201 });
  } catch (e) {
    return unreachable(e);
  }
};

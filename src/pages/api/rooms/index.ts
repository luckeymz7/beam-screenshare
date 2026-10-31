import type { APIRoute } from 'astro';
import { createRoom } from '../../../lib/livekit';
import { listRooms } from '../../../lib/rooms';

const unreachable = (e: unknown) => {
  console.error('LiveKit:', (e as Error).message);
  return Response.json({ error: 'The streaming server is unreachable. Try again in a moment.' }, { status: 503 });
};

export const GET: APIRoute = async () => {
  try {
    return Response.json({ rooms: await listRooms() }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return unreachable(e);
  }
};

const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');

export const POST: APIRoute = async ({ request }) => {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const title = clean(body.title, 60);
  const host = clean(body.name, 32);
  const visibility = body.visibility === 'private' ? 'private' : 'public';
  if (!title || !host) return Response.json({ error: 'A room title and your name are required.' }, { status: 400 });
  try {
    return Response.json(await createRoom({ title, host, visibility }), { status: 201 });
  } catch (e) {
    return unreachable(e);
  }
};

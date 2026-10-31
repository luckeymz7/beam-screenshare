import type { APIRoute } from 'astro';
import { getRoom, isHost, joinToken } from '../../../../lib/livekit';

export const POST: APIRoute = async ({ params, request }) => {
  const room = await getRoom(params.id ?? '').catch(() => undefined);
  if (room === undefined) return Response.json({ error: 'The streaming server is unreachable. Try again in a moment.' }, { status: 503 });
  if (!room) return Response.json({ error: 'This room has ended or never existed.' }, { status: 404 });
  const body = (await request.json().catch(() => ({}))) as { name?: unknown; hostKey?: unknown };
  const name = typeof body.name === 'string' ? body.name.trim().replace(/\s+/g, ' ').slice(0, 32) : '';
  if (!name) return Response.json({ error: 'Pick a name first.' }, { status: 400 });
  const role = isHost(room.meta, typeof body.hostKey === 'string' ? body.hostKey : null) ? 'host' : 'guest';
  return Response.json({ ...(await joinToken(room.info.id, name, role)), role, room: room.info });
};

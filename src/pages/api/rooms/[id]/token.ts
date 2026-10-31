import type { APIRoute } from 'astro';
import { getRoom, isHost, joinToken } from '../../../../lib/livekit';
import { apiError, unreachable } from '../../../../lib/http';

export const POST: APIRoute = async ({ params, request }) => {
  let room;
  try {
    room = await getRoom(params.id ?? '');
  } catch (e) {
    return unreachable(e);
  }
  if (!room) return apiError('gone', 'This room has ended or never existed.', 404);
  const body = (await request.json().catch(() => ({}))) as { name?: unknown; hostKey?: unknown };
  const name = typeof body.name === 'string' ? body.name.trim().replace(/\s+/g, ' ').slice(0, 32) : '';
  if (!name) return apiError('name', 'Pick a name first.', 400);
  const role = isHost(room.meta, typeof body.hostKey === 'string' ? body.hostKey : null) ? 'host' : 'guest';
  return Response.json({ ...(await joinToken(room.info.id, name, role)), role, room: room.info });
};

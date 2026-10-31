import type { APIRoute } from 'astro';
import { endRoom, getRoom, isHost, removeFromRoom } from '../../../../lib/livekit';

/** Host-only: remove someone, or end the room for everyone. */
export const POST: APIRoute = async ({ params, request }) => {
  const room = await getRoom(params.id ?? '');
  if (!room) return new Response(null, { status: 404 });
  if (!isHost(room.meta, request.headers.get('x-host-key'))) return new Response(null, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as { action?: unknown; identity?: unknown };

  if (body.action === 'end') {
    await endRoom(room.info.id);
    return new Response(null, { status: 204 });
  }
  if (body.action === 'remove' && typeof body.identity === 'string' && body.identity) {
    await removeFromRoom(room.info.id, body.identity).catch(() => {});
    return new Response(null, { status: 204 });
  }
  return Response.json({ error: 'Unknown action' }, { status: 400 });
};

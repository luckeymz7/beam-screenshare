import type { APIRoute } from 'astro';
import { endRoom, removeFromRoom } from '../../../../lib/livekit';
import { unreachable } from '../../../../lib/http';

/** Admin moderation: { action: 'end' } or { action: 'remove', identity }. */
export const POST: APIRoute = async ({ params, request }) => {
  const body = (await request.json().catch(() => ({}))) as { action?: unknown; identity?: unknown };
  const id = params.id ?? '';
  try {
    if (body.action === 'end') await endRoom(id);
    else if (body.action === 'remove' && typeof body.identity === 'string') await removeFromRoom(id, body.identity);
    else return Response.json({ error: 'Unknown action' }, { status: 400 });
    return new Response(null, { status: 204 });
  } catch (e) {
    return unreachable(e);
  }
};

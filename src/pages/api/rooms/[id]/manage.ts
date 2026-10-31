import type { APIRoute } from 'astro';
import { endRoom, getRoom, isHost, removeFromRoom, transferHost, updateSettings } from '../../../../lib/livekit';
import { unreachable } from '../../../../lib/http';

type Body = { action?: unknown; identity?: unknown; share?: unknown; approval?: unknown };

/**
 * Host-only:
 * - { action: 'end' } ends the room for everyone
 * - { action: 'remove', identity } removes someone
 * - { action: 'transfer', identity } makes someone else the host (this key stops working)
 * - { action: 'settings', share?, approval? } lets everyone share their screen / asks before letting in
 */
export const POST: APIRoute = async ({ params, request }) => {
  try {
    const room = await getRoom(params.id ?? '');
    if (!room) return new Response(null, { status: 404 });
    if (!isHost(room.meta, request.headers.get('x-host-key'))) return new Response(null, { status: 403 });
    const body = (await request.json().catch(() => ({}))) as Body;
    const identity = typeof body.identity === 'string' ? body.identity : '';

    if (body.action === 'end') {
      await endRoom(room.info.id);
      return new Response(null, { status: 204 });
    }
    if (body.action === 'remove' && identity) {
      await removeFromRoom(room.info.id, identity).catch(() => {});
      return new Response(null, { status: 204 });
    }
    if (body.action === 'transfer' && identity) {
      await transferHost(room.info.id, room.meta, identity);
      return new Response(null, { status: 204 });
    }
    if (body.action === 'settings') {
      const next = await updateSettings(room.info.id, room.meta, {
        share: typeof body.share === 'boolean' ? body.share : undefined,
        approval: typeof body.approval === 'boolean' ? body.approval : undefined,
      });
      return Response.json({ share: !!next.share, approval: !!next.approval });
    }
    return Response.json({ error: 'Unknown action' }, { status: 400 });
  } catch (e) {
    return unreachable(e);
  }
};

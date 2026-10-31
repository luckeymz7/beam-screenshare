import type { APIRoute } from 'astro';
import { getRoom, isHost } from '../../../../lib/livekit';
import { unreachable } from '../../../../lib/http';
import { decideRequest, pendingRequests } from '../../../../lib/requests';

/** Host-only: the room's door. GET who is waiting, POST { id, accept } to decide. */
async function hostRoom(id: string, hostKey: string | null) {
  const room = await getRoom(id);
  if (!room) return { error: new Response(null, { status: 404 }) };
  if (!isHost(room.meta, hostKey)) return { error: new Response(null, { status: 403 }) };
  return { room };
}

export const GET: APIRoute = async ({ params, request }) => {
  try {
    const { room, error } = await hostRoom(params.id ?? '', request.headers.get('x-host-key'));
    if (error) return error;
    return Response.json({ requests: await pendingRequests(room.info.id) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return unreachable(e);
  }
};

export const POST: APIRoute = async ({ params, request }) => {
  try {
    const { room, error } = await hostRoom(params.id ?? '', request.headers.get('x-host-key'));
    if (error) return error;
    const body = (await request.json().catch(() => ({}))) as { id?: unknown; accept?: unknown };
    if (typeof body.id !== 'string') return new Response(null, { status: 400 });
    await decideRequest(room.info.id, body.id, body.accept === true);
    return new Response(null, { status: 204 });
  } catch (e) {
    return unreachable(e);
  }
};

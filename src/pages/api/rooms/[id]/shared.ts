import type { APIRoute } from 'astro';
import { getRoom, isHost } from '../../../../lib/livekit';
import { track } from '../../../../lib/events';

/** The host's browser reports each time it starts sharing, for the admin's numbers. */
export const POST: APIRoute = async ({ params, request, locals }) => {
  const room = await getRoom(params.id ?? '').catch(() => null);
  if (!room || !isHost(room.meta, request.headers.get('x-host-key'))) return new Response(null, { status: 404 });
  await track('share', { room: room.info.id, userId: locals.user?.id });
  return new Response(null, { status: 204 });
};

import type { APIRoute } from 'astro';
import { getRoom, isHost, joinToken } from '../../../../lib/livekit';
import { apiError, unreachable } from '../../../../lib/http';
import { getMe, roomProfile } from '../../../../lib/users';
import { createRequest, requestState } from '../../../../lib/requests';
import { track } from '../../../../lib/events';

type Body = { name?: unknown; hostKey?: unknown; requestId?: unknown; requestSecret?: unknown };
const str = (v: unknown) => (typeof v === 'string' ? v : '');

/**
 * Joining a room. In a room that asks first, a guest's first call files a request (202 with its
 * id and secret); the browser then calls again with them until the host decides.
 */
export const POST: APIRoute = async ({ params, request, locals }) => {
  let room;
  try {
    room = await getRoom(params.id ?? '');
  } catch (e) {
    return unreachable(e);
  }
  if (!room) return apiError('gone', 'This room has ended or never existed.', 404);
  const body = (await request.json().catch(() => ({}))) as Body;
  const name = str(body.name).trim().replace(/\s+/g, ' ').slice(0, 32);
  if (!name) return apiError('name', 'Pick a name first.', 400);
  const role = isHost(room.meta, str(body.hostKey) || null) ? 'host' : 'guest';
  const me = await getMe(locals.user).catch(() => null);

  // The host always gets in; anyone else waits for a free spot
  if (role === 'guest' && room.info.max && room.info.participants >= room.info.max) {
    return apiError('full', 'This room is full.', 409);
  }

  if (room.info.approval && role === 'guest') {
    const requestId = str(body.requestId);
    if (!requestId) {
      const filed = await createRequest(room.info.id, { name, image: me?.image, userId: me?.id });
      return Response.json({ waiting: true, requestId: filed.id, requestSecret: filed.secret }, { status: 202 });
    }
    const state = await requestState(room.info.id, requestId, str(body.requestSecret));
    if (state === 'pending') return Response.json({ waiting: true, requestId }, { status: 202 });
    if (state === 'denied') return apiError('denied', 'The host didn’t let you in.', 403);
    if (state !== 'accepted') return apiError('expired', 'Your request expired. Ask again.', 410);
  }

  const token = await joinToken(room.info.id, name, role, me ? roomProfile(me) : null, room.info.share);
  await track('join', { room: room.info.id, userId: me?.id });
  return Response.json({ ...token, role, room: room.info, premium: !!me?.premium });
};

import type { APIRoute } from 'astro';
import { identityFromToken, setDeafenedFlag } from '../../../../lib/livekit';
import { unreachable } from '../../../../lib/http';

type Body = { token?: unknown; deafened?: unknown };

/**
 * Your own state in a room that everyone should see: { token, deafened }. The join token proves
 * who you are, so nobody can mark someone else.
 */
export const POST: APIRoute = async ({ params, request }) => {
  try {
    const body = (await request.json().catch(() => ({}))) as Body;
    if (typeof body.token !== 'string' || typeof body.deafened !== 'boolean') {
      return Response.json({ error: 'Bad request' }, { status: 400 });
    }
    const identity = await identityFromToken(params.id ?? '', body.token);
    if (!identity) return new Response(null, { status: 403 });
    await setDeafenedFlag(params.id ?? '', identity, body.deafened);
    return new Response(null, { status: 204 });
  } catch (e) {
    return unreachable(e);
  }
};

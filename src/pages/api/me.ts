import type { APIRoute } from 'astro';
import { getMe, saveProfile } from '../../lib/users';

const unauthorized = () => Response.json({ error: 'Log in first' }, { status: 401 });

/** The logged-in person (null when logged out). Polled by /premium while a payment settles. */
export const GET: APIRoute = async ({ locals }) =>
  Response.json(await getMe(locals.user), { headers: { 'Cache-Control': 'no-store' } });

/** Saves the bio and (premium) theme and entrance. The name and picture go through better-auth (updateUser). */
export const PATCH: APIRoute = async ({ locals, request }) => {
  const me = await getMe(locals.user);
  if (!me) return unauthorized();
  const body = (await request.json().catch(() => ({}))) as { bio?: unknown; theme?: unknown; entrance?: unknown };
  await saveProfile(me, body);
  return Response.json(await getMe(locals.user));
};

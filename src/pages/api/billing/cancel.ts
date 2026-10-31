import type { APIRoute } from 'astro';
import { cancelSubscription } from '../../../lib/billing';
import { getMe } from '../../../lib/users';
import { apiError } from '../../../lib/http';

/** Stops the renewals; premium lasts until the end of the paid month. */
export const POST: APIRoute = async ({ locals }) => {
  const me = await getMe(locals.user);
  if (!me) return apiError('login', 'Log in first.', 401);
  try {
    await cancelSubscription(me.id);
    return Response.json(await getMe(locals.user));
  } catch (e) {
    console.error('cancel:', (e as Error).message);
    return apiError('billing', 'Could not cancel right now. Try again in a moment.', 502);
  }
};

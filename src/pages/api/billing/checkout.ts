import type { APIRoute } from 'astro';
import { billingConfigured, startCheckout } from '../../../lib/billing';
import { getMe } from '../../../lib/users';
import { apiError } from '../../../lib/http';

/** Opens AbacatePay's checkout for the monthly plan and returns where to send the browser. */
export const POST: APIRoute = async ({ locals, url }) => {
  const me = await getMe(locals.user);
  if (!me) return apiError('login', 'Log in first.', 401);
  if (!billingConfigured()) return apiError('billing', 'Payments are not set up yet.', 503);
  if (me.plan === 'active' && me.premium) return apiError('already', 'You already have premium.', 409);
  try {
    return Response.json({ url: await startCheckout(me.id, url.origin) });
  } catch (e) {
    console.error('checkout:', (e as Error).message);
    return apiError('billing', 'Could not open the payment page. Try again in a moment.', 502);
  }
};

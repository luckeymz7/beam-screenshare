import type { APIRoute } from 'astro';
import { liveRooms } from '../../../lib/livekit';
import { eventSeries, totals } from '../../../lib/events';
import { billingConfigured, PRICE_CENTS } from '../../../lib/billing';

/** Everything on the admin's first screen. The middleware already checked it's an admin. */
export const GET: APIRoute = async ({ url }) => {
  const range = Math.min(365, Math.max(7, Number(url.searchParams.get('range')) || 30));
  const [live, series, sums] = await Promise.all([
    liveRooms().catch((e) => {
      console.error('admin live:', (e as Error).message);
      return null;
    }),
    eventSeries(range),
    totals(),
  ]);
  return Response.json(
    { live, series, ...sums, mrr: sums.paying * PRICE_CENTS, billing: billingConfigured() },
    { headers: { 'Cache-Control': 'no-store' } },
  );
};

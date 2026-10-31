import type { APIRoute } from 'astro';
import { handleWebhook, verifyWebhook } from '../../../lib/billing';

/**
 * AbacatePay → beam. Register https://<your domain>/api/billing/webhook in its dashboard with
 * the same secret as ABACATEPAY_WEBHOOK_SECRET.
 */
export const POST: APIRoute = async ({ request, url }) => {
  const raw = await request.text();
  if (!verifyWebhook(raw, url.searchParams.get('webhookSecret'), request.headers.get('x-webhook-signature'))) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const result = await handleWebhook(JSON.parse(raw));
    return Response.json({ ok: true, result });
  } catch (e) {
    // A 5xx makes AbacatePay retry later
    console.error('webhook:', (e as Error).message);
    return Response.json({ error: 'Failed' }, { status: 500 });
  }
};

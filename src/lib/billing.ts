import { createHmac, timingSafeEqual } from 'node:crypto';
import { eq, or } from 'drizzle-orm';
import { ABACATEPAY_API_KEY, ABACATEPAY_PRODUCT_ID, ABACATEPAY_WEBHOOK_SECRET } from 'astro:env/server';
import { db, ensureDb, schema } from './db';
import { track } from './events';

// Premium is one monthly plan sold through AbacatePay (https://docs.abacatepay.com). The
// product (R$ 9,84, cycle MONTHLY) is created once in its dashboard; its id goes in
// ABACATEPAY_PRODUCT_ID. A dev-mode API key gives a sandbox where nothing is really charged.

export const PRICE_CENTS = 984;
const API = 'https://api.abacatepay.com/v2';
/** One paid cycle of premium, with a couple of days of slack for late renewals. */
const CYCLE = 32 * 86_400_000;

export const billingConfigured = () => !!(ABACATEPAY_API_KEY && ABACATEPAY_PRODUCT_ID);

async function call<T>(path: string, body: object): Promise<T> {
  const res = await fetch(API + path, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ABACATEPAY_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => null)) as { data?: T; error?: string | null } | null;
  if (!res.ok || !json?.data) throw new Error(`AbacatePay ${path}: ${json?.error ?? res.status}`);
  return json.data;
}

/** Opens a subscription checkout for this user and returns the page to send them to. */
export async function startCheckout(userId: string, origin: string) {
  await ensureDb();
  const request = (methods: string[]) =>
    call<{ id: string; url: string }>('/subscriptions/create', {
      items: [{ id: ABACATEPAY_PRODUCT_ID, quantity: 1 }],
      externalId: userId,
      metadata: { userId },
      methods,
      returnUrl: `${origin}/premium`,
      completionUrl: `${origin}/premium?paid=1`,
    });
  // PIX subscriptions need "PIX Automático" on the AbacatePay account; card always works
  const checkout = await request(['PIX', 'CARD']).catch(() => request(['CARD']));

  const [existing] = await db.select().from(schema.subscriptions).where(eq(schema.subscriptions.userId, userId));
  const stillPremium = (existing?.premiumUntil?.getTime() ?? 0) > Date.now();
  const values = { userId, checkoutId: checkout.id, status: stillPremium ? existing!.status : 'pending' };
  await db.insert(schema.subscriptions).values(values).onConflictDoUpdate({ target: schema.subscriptions.userId, set: values });
  return checkout.url;
}

/** Stops renewals. Premium keeps running until the end of what was paid. */
export async function cancelSubscription(userId: string) {
  await ensureDb();
  const [sub] = await db.select().from(schema.subscriptions).where(eq(schema.subscriptions.userId, userId));
  if (!sub?.subscriptionId || sub.status !== 'active') return false;
  await call('/subscriptions/cancel', { id: sub.subscriptionId });
  await db.update(schema.subscriptions).set({ status: 'cancelled' }).where(eq(schema.subscriptions.userId, userId));
  return true;
}

// ---------- webhook ----------

// AbacatePay's public HMAC key, from https://docs.abacatepay.com/pages/webhooks/security
const ABACATEPAY_PUBLIC_KEY =
  't9dXRhHHo3yDEj5pVDYz0frf7q6bMKyMRmxxCPIPp3RCplBfXRxqlC6ZpiWmOqj4L63qEaeUOtrCI8P0VMUgo6iIga2ri9ogaHFs0WIIywSMg0q7RmBfybe1E5XJcfC4IW3alNqym0tXoAKkzvfEjZxV6bE0oG2zJrNNYmUCKZyV0KZ3JS8Votf9EAWWYdiDkMkpbMdPggfh1EqHlVkMiTady6jOR3hyzGEHrIz2Ret0xHKMbiqkr9HS1JhNHDX9';

const same = (a: string, b: string) => {
  const A = Buffer.from(a);
  const B = Buffer.from(b);
  return A.length === B.length && timingSafeEqual(A, B);
};

/** Both checks the docs ask for: the secret in the URL and the HMAC of the raw body. */
export function verifyWebhook(rawBody: string, secret: string | null, signature: string | null) {
  if (!ABACATEPAY_WEBHOOK_SECRET || !secret || !signature) return false;
  const expected = createHmac('sha256', ABACATEPAY_PUBLIC_KEY).update(Buffer.from(rawBody, 'utf8')).digest('base64');
  return same(secret, ABACATEPAY_WEBHOOK_SECRET) && same(expected, signature);
}

type Payment = { id: string; paidAmount?: number; amount: number; platformFee?: number; externalId?: string | null };
type Webhook = {
  id: string;
  event: string;
  data: {
    subscription?: { id: string; method?: string };
    payment?: Payment;
    checkout?: Payment & { methods?: string[] };
    payerInformation?: { method?: string };
  };
};

/** Finds whose subscription an event is about: by subscription, checkout, or our own id. */
async function findUser(data: Webhook['data']) {
  const subId = data.subscription?.id;
  const checkoutId = data.checkout?.id;
  const conditions = [
    subId ? eq(schema.subscriptions.subscriptionId, subId) : undefined,
    checkoutId ? eq(schema.subscriptions.checkoutId, checkoutId) : undefined,
  ].filter((c) => c !== undefined);
  if (conditions.length) {
    const [row] = await db.select().from(schema.subscriptions).where(or(...conditions));
    if (row) return row;
  }
  const external = data.checkout?.externalId ?? data.payment?.externalId;
  if (!external) return null;
  const [row] = await db.select().from(schema.subscriptions).where(eq(schema.subscriptions.userId, external));
  if (row) return row;
  // Paid without a row of ours (lost when the checkout was opened): our id still names the account
  const [account] = await db.select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.id, external));
  if (!account) return null;
  const [created] = await db.insert(schema.subscriptions).values({ userId: account.id, status: 'pending' }).returning();
  return created;
}

export async function handleWebhook(event: Webhook) {
  await ensureDb();
  // Deliveries are retried: handle each one once. It's marked done only after it worked, so a
  // failure halfway gets retried instead of lost.
  const [seen] = await db.select().from(schema.webhookEvents).where(eq(schema.webhookEvents.id, event.id));
  if (seen) return 'duplicate';
  const result = await applyWebhook(event);
  await db.insert(schema.webhookEvents).values({ id: event.id, at: new Date() }).onConflictDoNothing();
  return result;
}

async function applyWebhook(event: Webhook) {
  const sub = await findUser(event.data);
  if (!sub) {
    console.warn('AbacatePay webhook for an unknown subscription:', event.event, event.id);
    return 'unknown';
  }
  const userId = sub.userId;
  const payment = event.data.payment ?? event.data.checkout;
  const method = event.data.payerInformation?.method ?? event.data.subscription?.method ?? null;

  switch (event.event) {
    case 'subscription.completed':
    case 'subscription.renewed': {
      const from = Math.max(Date.now(), sub.premiumUntil?.getTime() ?? 0);
      await db
        .update(schema.subscriptions)
        .set({
          status: 'active',
          subscriptionId: event.data.subscription?.id ?? sub.subscriptionId,
          premiumUntil: new Date(from + CYCLE),
          method,
        })
        .where(eq(schema.subscriptions.userId, userId));
      if (payment) {
        await db
          .insert(schema.payments)
          .values({
            id: payment.id,
            userId,
            amount: payment.paidAmount ?? payment.amount,
            fee: payment.platformFee ?? 0,
            method,
            event: 'paid',
            at: new Date(),
          })
          .onConflictDoNothing();
      }
      if (event.event === 'subscription.completed') await track('premium', { userId });
      return 'premium';
    }
    case 'subscription.cancelled':
      await db.update(schema.subscriptions).set({ status: 'cancelled' }).where(eq(schema.subscriptions.userId, userId));
      return 'cancelled';
    case 'checkout.refunded':
    case 'subscription.refunded':
      await db
        .update(schema.subscriptions)
        .set({ status: 'cancelled', premiumUntil: new Date() })
        .where(eq(schema.subscriptions.userId, userId));
      if (payment) {
        await db
          .insert(schema.payments)
          .values({ id: `refund_${payment.id}`, userId, amount: -(payment.paidAmount ?? payment.amount), method, event: 'refunded', at: new Date() })
          .onConflictDoNothing();
      }
      return 'refunded';
    default:
      return 'ignored';
  }
}

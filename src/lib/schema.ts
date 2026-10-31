import { sql } from 'drizzle-orm';
import { blob, index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

const now = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;
const timestamps = {
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).default(now).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .default(now)
    .$onUpdate(() => new Date())
    .notNull(),
};

// ---------- better-auth core tables ----------

export const user = sqliteTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: integer('email_verified', { mode: 'boolean' }).default(false).notNull(),
  image: text('image'),
  ...timestamps,
});

export const session = sqliteTable(
  'session',
  {
    id: text('id').primaryKey(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    token: text('token').notNull().unique(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    ...timestamps,
  },
  (t) => [index('session_userId_idx').on(t.userId)],
);

export const account = sqliteTable(
  'account',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: integer('access_token_expires_at', { mode: 'timestamp_ms' }),
    refreshTokenExpiresAt: integer('refresh_token_expires_at', { mode: 'timestamp_ms' }),
    scope: text('scope'),
    password: text('password'),
    ...timestamps,
  },
  (t) => [index('account_userId_idx').on(t.userId)],
);

export const verification = sqliteTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    ...timestamps,
  },
  (t) => [index('verification_identifier_idx').on(t.identifier)],
);

/** better-auth's rate limiter, in the database so the limit holds across serverless instances */
export const rateLimit = sqliteTable('rate_limit', {
  id: text('id').primaryKey(),
  key: text('key').notNull().unique(),
  count: integer('count').notNull(),
  lastRequest: integer('last_request').notNull(),
});

// ---------- beam ----------

/** What people see on someone's profile card. The theme is a premium feature. */
export const profiles = sqliteTable('profiles', {
  userId: text('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  bio: text('bio').notNull().default(''),
  /** JSON: { primary, accent } */
  theme: text('theme'),
  /** Premium: a banner image (URL of an uploaded image) */
  banner: text('banner'),
  /** Premium: the animation everyone sees when you join a room */
  entrance: text('entrance'),
  ...timestamps,
});

/**
 * Premium is "premium_until is in the future": each paid cycle pushes it forward, so a late
 * webhook or a cancelled subscription still gets what was paid for.
 */
export const subscriptions = sqliteTable('subscriptions', {
  userId: text('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  subscriptionId: text('subscription_id'),
  checkoutId: text('checkout_id'),
  /** pending (checkout opened), active, cancelled, granted (by an admin) */
  status: text('status').notNull(),
  premiumUntil: integer('premium_until', { mode: 'timestamp_ms' }),
  method: text('method'),
  ...timestamps,
});

export const payments = sqliteTable(
  'payments',
  {
    id: text('id').primaryKey(),
    userId: text('user_id'),
    /** cents */
    amount: integer('amount').notNull(),
    fee: integer('fee').notNull().default(0),
    method: text('method'),
    event: text('event').notNull(),
    at: integer('at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [index('payments_at_idx').on(t.at)],
);

/** Webhook deliveries already handled, so a retry never extends premium twice. */
export const webhookEvents = sqliteTable('webhook_events', {
  id: text('id').primaryKey(),
  at: integer('at', { mode: 'timestamp_ms' }).notNull(),
});

/** People waiting to be let into a private room that asks first. */
export const joinRequests = sqliteTable(
  'join_requests',
  {
    id: text('id').primaryKey(),
    room: text('room').notNull(),
    name: text('name').notNull(),
    image: text('image'),
    userId: text('user_id'),
    secretHash: text('secret_hash').notNull(),
    /** pending, accepted, denied */
    status: text('status').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [index('join_requests_room_idx').on(t.room)],
);

/**
 * One row per pair of people (user_a < user_b, so a pair can't appear twice): pending until
 * the person who didn't ask accepts.
 */
export const friendships = sqliteTable(
  'friendships',
  {
    userA: text('user_a')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    userB: text('user_b')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    requestedBy: text('requested_by').notNull(),
    /** pending, accepted */
    status: text('status').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userA, t.userB] }),
    index('friendships_a_idx').on(t.userA),
    index('friendships_b_idx').on(t.userB),
  ],
);

/** Uploaded profile pictures and banners, resized in the browser before upload. */
export const images = sqliteTable(
  'images',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** avatar, banner */
    kind: text('kind').notNull(),
    mime: text('mime').notNull(),
    data: blob('data', { mode: 'buffer' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.kind] })],
);

/** The code in someone's friend link (beam…/add/<code>). */
export const friendCodes = sqliteTable('friend_codes', {
  userId: text('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  code: text('code').notNull().unique(),
});

/** One row per thing worth counting on the admin dashboard. */
export const events = sqliteTable(
  'events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** room, join, share, signup, premium */
    type: text('type').notNull(),
    day: text('day').notNull(),
    at: integer('at', { mode: 'timestamp_ms' }).notNull(),
    room: text('room'),
    userId: text('user_id'),
  },
  (t) => [index('events_day_idx').on(t.day)],
);

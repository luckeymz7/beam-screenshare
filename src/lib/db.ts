import { mkdirSync } from 'node:fs';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { DATABASE_AUTH_TOKEN, DATABASE_URL } from 'astro:env/server';
import * as schema from './schema';

// Accounts, premium, previews and metrics. LiveKit stays the source of truth for the rooms.
if (DATABASE_URL.startsWith('file:')) {
  if (process.env.VERCEL) throw new Error('DATABASE_URL must point to a Turso database on Vercel');
  const dir = DATABASE_URL.slice(5).replace(/[^/\\]+$/, '');
  if (dir) mkdirSync(dir, { recursive: true });
}

export const client = createClient({ url: DATABASE_URL, authToken: DATABASE_AUTH_TOKEN });
export const db = drizzle(client, { schema });
export { schema };

const ts = `integer not null default (cast(unixepoch('subsecond') * 1000 as integer))`;

// Tables are created on first use, so a fresh deploy needs no migration step.
const MIGRATION = [
  `create table if not exists user (
    id text primary key, name text not null, email text not null unique,
    email_verified integer not null default 0, image text,
    created_at ${ts}, updated_at ${ts})`,
  `create table if not exists session (
    id text primary key, expires_at integer not null, token text not null unique,
    ip_address text, user_agent text,
    user_id text not null references user(id) on delete cascade,
    created_at ${ts}, updated_at ${ts})`,
  `create index if not exists session_userId_idx on session(user_id)`,
  `create table if not exists account (
    id text primary key, account_id text not null, provider_id text not null,
    user_id text not null references user(id) on delete cascade,
    access_token text, refresh_token text, id_token text,
    access_token_expires_at integer, refresh_token_expires_at integer,
    scope text, password text, created_at ${ts}, updated_at ${ts})`,
  `create index if not exists account_userId_idx on account(user_id)`,
  `create table if not exists verification (
    id text primary key, identifier text not null, value text not null,
    expires_at integer not null, created_at ${ts}, updated_at ${ts})`,
  `create index if not exists verification_identifier_idx on verification(identifier)`,
  `create table if not exists profiles (
    user_id text primary key references user(id) on delete cascade,
    bio text not null default '', theme text, created_at ${ts}, updated_at ${ts})`,
  `create table if not exists subscriptions (
    user_id text primary key references user(id) on delete cascade,
    subscription_id text, checkout_id text, status text not null, premium_until integer, method text,
    created_at ${ts}, updated_at ${ts})`,
  `create index if not exists subscriptions_sub_idx on subscriptions(subscription_id)`,
  `create index if not exists subscriptions_checkout_idx on subscriptions(checkout_id)`,
  `create table if not exists payments (
    id text primary key, user_id text, amount integer not null, fee integer not null default 0,
    method text, event text not null, at integer not null)`,
  `create index if not exists payments_at_idx on payments(at)`,
  `create table if not exists webhook_events (id text primary key, at integer not null)`,
  `create table if not exists join_requests (
    id text primary key, room text not null, name text not null, image text, user_id text,
    secret_hash text not null, status text not null, created_at integer not null)`,
  `create index if not exists join_requests_room_idx on join_requests(room)`,
  `create table if not exists events (
    id integer primary key autoincrement, type text not null, day text not null, at integer not null,
    room text, user_id text)`,
  `create index if not exists events_day_idx on events(day)`,
  `create table if not exists rate_limit (
    id text primary key, key text not null unique, count integer not null, last_request integer not null)`,
  `create table if not exists friendships (
    user_a text not null references user(id) on delete cascade,
    user_b text not null references user(id) on delete cascade,
    requested_by text not null, status text not null, created_at integer not null,
    primary key (user_a, user_b))`,
  `create index if not exists friendships_a_idx on friendships(user_a)`,
  `create index if not exists friendships_b_idx on friendships(user_b)`,
  `create table if not exists friend_codes (
    user_id text primary key references user(id) on delete cascade, code text not null unique)`,
  `create table if not exists images (
    user_id text not null references user(id) on delete cascade, kind text not null,
    mime text not null, data blob not null, updated_at integer not null,
    primary key (user_id, kind))`,
  // raw tables (src/lib/thumbs.ts)
  'create table if not exists thumbs (room text primary key, mime text not null, data blob not null, updated_at integer not null)',
  'create table if not exists creations (who text not null, at integer not null)',
];

// Columns added after a table first shipped. SQLite has no "add column if not exists", so each
// one is tried and "duplicate column" (already added) is ignored.
const ADDED_COLUMNS = ['alter table profiles add column banner text', 'alter table profiles add column entrance text'];

let ready: Promise<void> | undefined;

export function ensureDb() {
  ready ??= client.batch(MIGRATION, 'write').then(async () => {
    // Side by side: one round trip instead of one per column
    await Promise.all(
      ADDED_COLUMNS.map((sql) =>
        client.execute(sql).catch((e: Error) => {
          if (!/duplicate column/i.test(e.message)) throw e;
        }),
      ),
    );
  });
  return ready;
}

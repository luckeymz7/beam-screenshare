import { betterAuth } from 'better-auth';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import {
  ADMIN_EMAILS,
  BETTER_AUTH_SECRET,
  BETTER_AUTH_URL,
  DISCORD_CLIENT_ID,
  DISCORD_CLIENT_SECRET,
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
} from 'astro:env/server';
import { db, ensureDb, schema } from './db';
import { track } from './events';

// Without a secret in production, login stays off (and the rest of beam keeps working) rather
// than signing sessions with a key anyone can read in this repository
const loginReady = !!BETTER_AUTH_SECRET || import.meta.env.DEV;
if (!loginReady) console.warn('BETTER_AUTH_SECRET is not set: login is turned off');

// Logging in is optional: it adds a profile, friends and premium, but beam works the same
// without it. Email + password, or one click with Google or Discord.
export const emailLogin = loginReady;
const socialProviders = !loginReady ? {} : {
  ...(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET
    ? { google: { clientId: GOOGLE_CLIENT_ID, clientSecret: GOOGLE_CLIENT_SECRET, prompt: 'select_account' as const } }
    : {}),
  ...(DISCORD_CLIENT_ID && DISCORD_CLIENT_SECRET
    ? { discord: { clientId: DISCORD_CLIENT_ID, clientSecret: DISCORD_CLIENT_SECRET } }
    : {}),
};

export type Provider = 'google' | 'discord';
export const providers = Object.keys(socialProviders) as Provider[];

export const auth = betterAuth({
  secret: BETTER_AUTH_SECRET ?? 'dev-only-secret-change-me-dev-only-secret',
  // Locally, use whatever host the site is opened on
  baseURL: import.meta.env.DEV ? undefined : BETTER_AUTH_URL,
  // The site also answers on the vercel.app addresses of this project. Vercel only routes a
  // host here if it belongs to the project, so a request whose Origin matches the host it was
  // sent to is same-origin. Never a wildcard: anyone can create a *.vercel.app site.
  trustedOrigins: (request) => {
    const host = request?.headers.get('host');
    return host ? [`https://${host}`] : [];
  },
  database: drizzleAdapter(db, { provider: 'sqlite', schema }),
  socialProviders,
  emailAndPassword: { enabled: emailLogin, minPasswordLength: 8, maxPasswordLength: 128 },
  // A Google/Discord login never merges into an email account whose address wasn't verified
  // (better-auth's default): otherwise someone could sign up with your email first and keep
  // access to your account once you log in with Google.
  account: { accountLinking: { enabled: true } },
  // Slows down password guessing. Kept in the database so the limit holds across Vercel's
  // instances (in memory, each instance would count on its own).
  rateLimit: {
    enabled: !import.meta.env.DEV,
    storage: 'database',
    customRules: {
      '/sign-in/email': { window: 60, max: 5 },
      '/sign-up/email': { window: 300, max: 3 },
    },
  },
  // Pages read the session from a signed cookie for 5 minutes instead of the database
  session: { cookieCache: { enabled: true, maxAge: 5 * 60 } },
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          await ensureDb();
          return { data: user };
        },
        after: async (user) => {
          await track('signup', { userId: user.id });
        },
      },
    },
  },
});

export type Session = typeof auth.$Infer.Session;
export type User = Session['user'];

const admins = new Set(
  (ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
);
export const isAdmin = (user: { email: string } | null | undefined) => !!user && admins.has(user.email.toLowerCase());

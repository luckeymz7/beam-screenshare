import { and, eq } from 'drizzle-orm';
import { db, ensureDb, schema } from './db';
import { isAdmin, type User } from './auth';
import { parseTheme, toEntrance, toTheme, type Entrance, type Theme } from './themes';

export const BIO_MAX = 190;

/** What a logged-in person's pages and islands need to know about them. */
export type Me = {
  id: string;
  name: string;
  email: string;
  image: string | null;
  bio: string;
  theme: Theme | null;
  /** Premium: banner image URL */
  banner: string | null;
  /** Premium: room entrance animation */
  entrance: Entrance | null;
  premium: boolean;
  premiumUntil: number | null;
  /** active: renews by itself; cancelled: runs until premiumUntil; granted: given by an admin */
  plan: 'none' | 'pending' | 'active' | 'cancelled' | 'granted';
  admin: boolean;
};

export async function getMe(user: User | null | undefined): Promise<Me | null> {
  if (!user) return null;
  await ensureDb();
  const [[profile], [sub]] = await Promise.all([
    db.select().from(schema.profiles).where(eq(schema.profiles.userId, user.id)),
    db.select().from(schema.subscriptions).where(eq(schema.subscriptions.userId, user.id)),
  ]);
  const until = sub?.premiumUntil?.getTime() ?? null;
  const premium = !!until && until > Date.now();
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    image: user.image ?? null,
    bio: profile?.bio ?? '',
    // Kept when premium runs out, so it comes back on renewal, but only shown while premium
    theme: premium ? parseTheme(profile?.theme) : null,
    banner: premium ? (profile?.banner ?? null) : null,
    entrance: premium ? toEntrance(profile?.entrance) : null,
    premium,
    premiumUntil: until,
    plan: (sub?.status as Me['plan']) ?? 'none',
    admin: isAdmin(user),
  };
}

export async function saveProfile(me: Me, input: { bio?: unknown; theme?: unknown; entrance?: unknown }) {
  const bio = typeof input.bio === 'string' ? input.bio.trim().replace(/\s+/g, ' ').slice(0, BIO_MAX) : me.bio;
  const values: { userId: string; bio: string; theme?: string | null; entrance?: string | null } = { userId: me.id, bio };
  // Only premium can change the theme and the entrance; null clears them
  if (me.premium && input.theme !== undefined) {
    const theme = toTheme(input.theme);
    values.theme = theme ? JSON.stringify(theme) : null;
  }
  if (me.premium && input.entrance !== undefined) values.entrance = toEntrance(input.entrance);
  await db.insert(schema.profiles).values(values).onConflictDoUpdate({ target: schema.profiles.userId, set: values });
}

// ---------- uploaded pictures ----------

export type ImageKind = 'avatar' | 'banner';
/** Already resized in the browser (256×256 and 960×320); these are generous ceilings. */
export const IMAGE_LIMITS: Record<ImageKind, number> = { avatar: 150 * 1024, banner: 400 * 1024 };
export const IMAGE_TYPES = new Set(['image/webp', 'image/jpeg', 'image/png']);

/** Stores a picture and returns its URL (versioned, so browsers can cache it forever). */
export async function saveImage(userId: string, kind: ImageKind, mime: string, data: ArrayBuffer) {
  await ensureDb();
  const at = new Date();
  const values = { userId, kind, mime, data: Buffer.from(data), updatedAt: at };
  await db
    .insert(schema.images)
    .values(values)
    .onConflictDoUpdate({ target: [schema.images.userId, schema.images.kind], set: { mime, data: values.data, updatedAt: at } });
  const url = `/api/img/${userId}/${kind}?v=${at.getTime()}`;
  if (kind === 'banner') {
    await db
      .insert(schema.profiles)
      .values({ userId, banner: url })
      .onConflictDoUpdate({ target: schema.profiles.userId, set: { banner: url } });
  }
  return url;
}

export async function removeImage(userId: string, kind: ImageKind) {
  await ensureDb();
  await db.delete(schema.images).where(and(eq(schema.images.userId, userId), eq(schema.images.kind, kind)));
  if (kind === 'banner') await db.update(schema.profiles).set({ banner: null }).where(eq(schema.profiles.userId, userId));
}

export async function getImage(userId: string, kind: ImageKind) {
  await ensureDb();
  const [row] = await db
    .select()
    .from(schema.images)
    .where(and(eq(schema.images.userId, userId), eq(schema.images.kind, kind)));
  return row ?? null;
}

/**
 * What everyone in a room sees about a logged-in participant (LiveKit participant metadata,
 * signed into the join token, so nobody can claim premium they don't have).
 */
export const roomProfile = (me: Me) => ({
  uid: me.id,
  image: me.image,
  bio: me.bio || undefined,
  premium: me.premium || undefined,
  theme: me.theme ?? undefined,
  banner: me.banner ?? undefined,
  entrance: me.entrance ?? undefined,
});
export type RoomProfile = ReturnType<typeof roomProfile>;

/** Admin: give or take away premium by hand (support, gifts, tests). */
export async function grantPremium(userId: string, days: number) {
  await ensureDb();
  const until = days > 0 ? new Date(Date.now() + days * 86_400_000) : new Date();
  const values = { userId, status: days > 0 ? 'granted' : 'cancelled', premiumUntil: until };
  await db
    .insert(schema.subscriptions)
    .values(values)
    .onConflictDoUpdate({ target: schema.subscriptions.userId, set: { status: values.status, premiumUntil: until } });
}

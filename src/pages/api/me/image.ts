import type { APIRoute } from 'astro';
import { eq } from 'drizzle-orm';
import { db, schema } from '../../../lib/db';
import { getMe, IMAGE_LIMITS, IMAGE_TYPES, removeImage, saveImage, type ImageKind } from '../../../lib/users';

const kindOf = (url: URL): ImageKind | null => {
  const k = url.searchParams.get('kind');
  return k === 'avatar' || k === 'banner' ? k : null;
};

/**
 * PUT ?kind=avatar|banner with the image as the body (already resized by the browser).
 * Everyone can set a picture; the banner is premium.
 */
export const PUT: APIRoute = async ({ locals, request, url }) => {
  const me = await getMe(locals.user);
  if (!me) return Response.json({ error: 'Log in first' }, { status: 401 });
  const kind = kindOf(url);
  if (!kind) return Response.json({ error: 'Unknown kind' }, { status: 400 });
  if (kind === 'banner' && !me.premium) return Response.json({ error: 'Premium only', code: 'premium' }, { status: 403 });
  const mime = request.headers.get('content-type') ?? '';
  if (!IMAGE_TYPES.has(mime)) return Response.json({ error: 'Unsupported image', code: 'type' }, { status: 415 });
  const data = await request.arrayBuffer();
  if (data.byteLength === 0 || data.byteLength > IMAGE_LIMITS[kind]) {
    return Response.json({ error: 'Too big', code: 'size' }, { status: 413 });
  }
  const imageUrl = await saveImage(me.id, kind, mime, data);
  if (kind === 'avatar') await db.update(schema.user).set({ image: imageUrl }).where(eq(schema.user.id, me.id));
  return Response.json({ url: imageUrl });
};

export const DELETE: APIRoute = async ({ locals, url }) => {
  const me = await getMe(locals.user);
  if (!me) return Response.json({ error: 'Log in first' }, { status: 401 });
  const kind = kindOf(url);
  if (!kind) return Response.json({ error: 'Unknown kind' }, { status: 400 });
  await removeImage(me.id, kind);
  if (kind === 'avatar') await db.update(schema.user).set({ image: null }).where(eq(schema.user.id, me.id));
  return new Response(null, { status: 204 });
};

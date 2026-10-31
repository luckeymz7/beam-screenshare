import type { APIRoute } from 'astro';
import { getRoom, isHost } from '../../../../lib/livekit';
import { getThumb, saveThumb } from '../../../../lib/db';
import { unreachable } from '../../../../lib/http';

const TYPES = new Set(['image/jpeg', 'image/webp']);
const MAX = 300 * 1024;

export const GET: APIRoute = async ({ params }) => {
  const thumb = await getThumb(params.id ?? '');
  if (!thumb) return new Response(null, { status: 404 });
  return new Response(thumb.data, {
    // The URL carries ?v=<updatedAt>, so each version can be cached
    headers: { 'Content-Type': thumb.mime, 'Cache-Control': 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff' },
  });
};

/** The host's browser uploads a small frame of the shared screen every few seconds. */
export const PUT: APIRoute = async ({ params, request }) => {
  let room;
  try {
    room = await getRoom(params.id ?? '');
  } catch (e) {
    return unreachable(e);
  }
  if (!room) return new Response(null, { status: 404 });
  if (!isHost(room.meta, request.headers.get('x-host-key'))) return new Response(null, { status: 403 });
  // Private rooms are never listed, so they never need a preview
  if (room.info.visibility !== 'public') return new Response(null, { status: 403 });
  const mime = request.headers.get('content-type') ?? '';
  if (!TYPES.has(mime)) return new Response(null, { status: 415 });
  const data = await request.arrayBuffer();
  if (data.byteLength === 0 || data.byteLength > MAX) return new Response(null, { status: 413 });
  await saveThumb(room.info.id, mime, data);
  return new Response(null, { status: 204 });
};

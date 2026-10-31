import type { APIRoute } from 'astro';
import { getImage } from '../../../../lib/users';

/** Uploaded pictures. The URL carries ?v=<updated>, so each version can be cached for good. */
export const GET: APIRoute = async ({ params }) => {
  const kind = params.kind;
  if (kind !== 'avatar' && kind !== 'banner') return new Response(null, { status: 404 });
  const image = await getImage(params.user ?? '', kind);
  if (!image) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(image.data), {
    headers: {
      'Content-Type': image.mime,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      // Uploaded content: never let it run as a page
      'Content-Security-Policy': "default-src 'none'; sandbox",
    },
  });
};

import { defineMiddleware } from 'astro:middleware';
import { isLang, pickLang } from './lib/i18n';

export const onRequest = defineMiddleware((ctx, next) => {
  // The language switcher links to ?lang=xx: remember it, then drop it from the address
  const requested = ctx.url.searchParams.get('lang');
  if (isLang(requested) && ctx.request.method === 'GET') {
    const url = new URL(ctx.url);
    url.searchParams.delete('lang');
    return new Response(null, {
      status: 303,
      headers: {
        Location: url.pathname + url.search,
        'Set-Cookie': `lang=${requested}; Path=/; Max-Age=31536000; SameSite=Lax`,
      },
    });
  }
  ctx.locals.lang = pickLang(ctx.cookies.get('lang')?.value, ctx.request.headers.get('accept-language'));
  return next();
});

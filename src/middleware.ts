import { defineMiddleware } from 'astro:middleware';
import { isLang, pickLang } from './lib/i18n';
import { auth, isAdmin } from './lib/auth';

export const onRequest = defineMiddleware(async (ctx, next) => {
  const { pathname } = ctx.url;

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

  // better-auth answers its own routes
  ctx.locals.user = null;
  if (pathname.startsWith('/api/auth/')) return next();

  const isApi = pathname.startsWith('/api/');
  // Session cookies are SameSite=Lax; also refuse cross-site writes outright (webhooks carry
  // their own proof and come from AbacatePay's servers)
  if (isApi && ctx.request.method !== 'GET' && !pathname.startsWith('/api/billing/webhook')) {
    const origin = ctx.request.headers.get('origin');
    if (origin && origin !== ctx.url.origin) return Response.json({ error: 'Bad origin' }, { status: 403 });
  }

  try {
    const session = await auth.api.getSession({ headers: ctx.request.headers });
    ctx.locals.user = session?.user ?? null;
  } catch (e) {
    // A database hiccup logs people out for a moment instead of breaking the page
    console.error('session:', (e as Error).message);
  }

  // The admin is invisible to everyone else
  if (pathname === '/admin' || pathname.startsWith('/admin/') || pathname.startsWith('/api/admin/')) {
    if (!isAdmin(ctx.locals.user)) {
      return pathname.startsWith('/api/') ? Response.json({ error: 'Not found' }, { status: 404 }) : ctx.rewrite('/404');
    }
  }
  return next();
});

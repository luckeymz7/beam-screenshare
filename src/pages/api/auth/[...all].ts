import type { APIRoute } from 'astro';
import { auth } from '../../../lib/auth';
import { ensureDb } from '../../../lib/db';

export const ALL: APIRoute = async ({ request }) => {
  await ensureDb();
  return auth.handler(request);
};

import { supabase } from '../../db/supabase.js';
import { getAdminIds } from '../admins.js';

const authCache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

export function invalidateCache(userId) {
  authCache.delete(String(userId));
}

export default async function authMiddleware(ctx, next) {
  if (!ctx.from) return;

  const userId = String(ctx.from.id);

  if (getAdminIds().includes(userId)) {
    ctx.isAdmin = true;
    return next();
  }

  const cached = authCache.get(userId);
  if (cached && cached.expires > Date.now()) {
    ctx.isGuest = !cached.allowed;
    return next();
  }

  const { data } = await supabase
    .from('access_list')
    .select('active')
    .eq('user_id', ctx.from.id)
    .eq('active', true)
    .maybeSingle();

  const allowed = !!data;

  authCache.set(userId, {
    allowed,
    expires: Date.now() + CACHE_TTL,
  });

  ctx.isGuest = !allowed;
  return next();
}

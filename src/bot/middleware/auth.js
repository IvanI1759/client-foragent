import { supabase } from '../../db/supabase.js';
import { recordAuditEvent } from '../../db/queries.js';
import { getAdminIds } from '../admins.js';

const authCache = new Map();
const CACHE_TTL = 5 * 60 * 1000;
const DENIED_AUDIT_TTL = 30 * 60 * 1000;
const deniedAuditCache = new Map();

export function invalidateCache(userId) {
  authCache.delete(String(userId));
}

function shouldAuditDenied(userId) {
  const key = String(userId);
  const last = deniedAuditCache.get(key);
  if (last && Date.now() - last < DENIED_AUDIT_TTL) {
    return false;
  }
  deniedAuditCache.set(key, Date.now());
  return true;
}

function auditBestEffort(eventType, options) {
  recordAuditEvent(eventType, options).catch((error) => {
    console.error(`[AUDIT] event=${eventType} error=${error.message}`);
  });
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

  const { data, error } = await supabase
    .from('access_list')
    .select('active')
    .eq('user_id', ctx.from.id)
    .eq('active', true)
    .maybeSingle();

  if (error) {
    console.error(`[AUTH] user_id=${userId} error=${error.message}`);
    auditBestEffort('auth_db_error', {
      severity: 'error',
      actorUserId: ctx.from.id,
      meta: { error: error.message },
    });
    await ctx.reply('Сервис временно недоступен. Попробуйте чуть позже.').catch(() => {});
    return;
  }

  const allowed = !!data;

  authCache.set(userId, {
    allowed,
    expires: Date.now() + CACHE_TTL,
  });

  ctx.isGuest = !allowed;
  if (!allowed && shouldAuditDenied(userId)) {
    auditBestEffort('access_denied', {
      severity: 'warning',
      actorUserId: ctx.from.id,
      meta: {
        source: 'auth_middleware',
      },
    });
  }
  return next();
}

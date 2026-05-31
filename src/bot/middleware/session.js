import { getSession, saveSession } from '../../db/queries.js';
import {
  emptySession,
  getCachedSession,
  setCachedSession,
} from '../../db/sessionCache.js';

function formatErrorDetail(error) {
  const base = error?.message ?? JSON.stringify(error);
  const cause = error?.cause?.message ?? error?.cause;
  return cause ? `${base} cause=${cause}` : base;
}

export default async function sessionMiddleware(ctx, next) {
  if (!ctx.from) return next();
  const userId = ctx.from.id;

  let session;
  try {
    session = await getSession(userId);
    setCachedSession(userId, session);
  } catch (e) {
    console.error(`[SESSION] user_id=${userId} load_error=${formatErrorDetail(e)}`);
    session = getCachedSession(userId) ?? emptySession();
    if (getCachedSession(userId)) {
      console.warn(`[SESSION] user_id=${userId} using in-memory fallback`);
    }
  }

  ctx.session = {
    selected_agent: session.selected_agent || null,
    message_history: Array.isArray(session.message_history) ? session.message_history : [],
  };
  const before = JSON.stringify(ctx.session);

  await next();

  setCachedSession(userId, ctx.session);

  const after = JSON.stringify(ctx.session);
  if (before === after) return;

  try {
    await saveSession(userId, ctx.session);
  } catch (e) {
    console.error(`[SESSION] user_id=${userId} save_error=${formatErrorDetail(e)}`);
    console.warn(`[SESSION] user_id=${userId} kept in-memory session only`);
  }
}

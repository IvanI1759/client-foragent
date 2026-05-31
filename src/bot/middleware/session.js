import { getSession, saveSession } from '../../db/queries.js';

export default async function sessionMiddleware(ctx, next) {
  if (!ctx.from) return next();
  const userId = ctx.from.id;

  let session;
  try {
    session = await getSession(userId);
  } catch (e) {
    const detail = e?.message ?? JSON.stringify(e);
    console.error(`[SESSION] user_id=${userId} load_error=${detail}`);
    session = { user_id: userId, selected_agent: null, message_history: [] };
  }

  ctx.session = {
    selected_agent: session.selected_agent || null,
    message_history: Array.isArray(session.message_history) ? session.message_history : [],
  };
  const before = JSON.stringify(ctx.session);

  await next();

  const after = JSON.stringify(ctx.session);
  if (before === after) return;

  try {
    await saveSession(userId, ctx.session);
  } catch (e) {
    const detail = e?.message ?? JSON.stringify(e);
    console.error(`[SESSION] user_id=${userId} save_error=${detail}`);
  }
}

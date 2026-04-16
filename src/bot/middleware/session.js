import { getSession, saveSession } from '../../db/queries.js';

export default async function sessionMiddleware(ctx, next) {
  if (!ctx.from) return next();
  const userId = ctx.from.id;

  const session = await getSession(userId);
  ctx.session = {
    selected_agent: session.selected_agent || null,
    message_history: Array.isArray(session.message_history) ? session.message_history : [],
  };

  await next();

  try {
    await saveSession(userId, ctx.session);
  } catch (e) {
    console.error(`[SESSION] user_id=${userId} save_error`);
  }
}

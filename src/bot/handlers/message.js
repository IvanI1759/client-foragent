import { askMarketer } from '../../agents/marketer.js';
import { askCopywriter } from '../../agents/copywriter.js';
import { askAds } from '../../agents/ads.js';
import { askPackager } from '../../agents/packager.js';
import { askConsultant } from '../../agents/consultant.js';
import { checkAndIncrementUserRateLimit, clearSessionHistory, hasAssistantResponse, recordAuditEvent } from '../../db/queries.js';
import { AGENTS_KEYBOARD, CONTROL_KEYBOARD, AGENT_ICONS, AGENT_NAMES, OWNER_USERNAME } from './agent.js';

const MAX_MESSAGE_LENGTH = 4000;
const TELEGRAM_MESSAGE_LIMIT = 4000;
const HISTORY_PAIRS = 10;
const GUEST_RATE_LIMIT = parseInt(process.env.GUEST_RATE_LIMIT, 10) || 0;
const MAX_PENDING_REQUESTS_PER_USER = 2;
const requestQueues = new Map();

const AGENT_DISPATCH = {
  marketer: askMarketer,
  copywriter: askCopywriter,
  ads: askAds,
  packager: askPackager,
};

const DONT_KNOW_RE = /не могу помочь|не знаю/i;
const OWNER_FALLBACK = `По этому вопросу напишите владельцу: ${OWNER_USERNAME}`;
const GREETING_PREFIX_RE = /^\s*(?:👋\s*)?(?:привет(?:ик)?|здравствуй(?:те)?|добрый день|добрый вечер|добро пожаловать)[!.,\s-]*/i;

const ERROR_MESSAGES = {
  GEMINI_TIMEOUT: 'Ответ занимает слишком много времени. Попробуйте короче сформулировать вопрос.',
  GEMINI_RATE_LIMIT: 'Слишком много запросов. Подождите минуту и попробуйте снова.',
  GEMINI_SERVER_ERROR: 'Сервис временно недоступен. Попробуйте через минуту.',
  GEMINI_GLOBAL_LIMIT: 'Сервис временно недоступен. Попробуйте завтра.',
  GEMINI_EMPTY_RESPONSE: 'Не удалось получить ответ. Переформулируйте вопрос.',
};

async function notifyOwner(ctx, count) {
  const ownerId = process.env.OWNER_CHAT_ID;
  if (!ownerId) return;
  const limit = parseInt(process.env.DAILY_API_LIMIT, 10) || 250;
  try {
    await ctx.telegram.sendMessage(
      ownerId,
      `⚠️ Использовано ${count}/${limit} запросов Gemini API за сегодня.`
    );
  } catch (_) {}
}

function accessCta(userId) {
  return `🔑 Хотите получить доступ? Ваш ID: ${userId}\nОтправьте его ${OWNER_USERNAME}`;
}

const TYPING_INTERVAL_MS = 4000;
const PLACEHOLDER_TEXT = '🤔 Думаю…';

function auditBestEffort(eventType, options) {
  recordAuditEvent(eventType, options).catch((error) => {
    console.error(`[AUDIT] event=${eventType} error=${error.message}`);
  });
}

async function shouldAllowGreeting(userId) {
  try {
    return !(await hasAssistantResponse(userId));
  } catch (error) {
    console.error(`[AUDIT] event=assistant_response_sent_lookup error=${error.message}`);
    return false;
  }
}

function stripGreetingPrefix(text, allowGreeting) {
  if (!text || allowGreeting) return text;
  const stripped = text.replace(GREETING_PREFIX_RE, '').trimStart();
  return stripped || text;
}

function enqueueUserRequest(userId, task) {
  const key = String(userId);
  const state = requestQueues.get(key) || {
    tail: Promise.resolve(),
    size: 0,
  };

  if (state.size >= MAX_PENDING_REQUESTS_PER_USER) {
    return { accepted: false, queueSize: state.size };
  }

  state.size += 1;
  const run = state.tail
    .catch(() => {})
    .then(task)
    .finally(() => {
      state.size -= 1;
      if (state.size === 0) {
        requestQueues.delete(key);
      }
    });

  state.tail = run;
  requestQueues.set(key, state);

  return { accepted: true, promise: run };
}

function startTypingLoop(ctx) {
  ctx.sendChatAction('typing').catch(() => {});
  return setInterval(() => {
    ctx.sendChatAction('typing').catch(() => {});
  }, TYPING_INTERVAL_MS);
}

async function replaceOrReply(ctx, placeholderId, text, extra) {
  if (placeholderId) {
    try {
      await ctx.telegram.editMessageText(ctx.chat.id, placeholderId, undefined, text, extra);
      return;
    } catch (_) {
      await ctx.telegram.deleteMessage(ctx.chat.id, placeholderId).catch(() => {});
    }
  }
  await ctx.reply(text, extra);
}

function splitMessage(text, limit = TELEGRAM_MESSAGE_LIMIT) {
  const parts = [];
  let remaining = (text || '').trim();

  while (remaining.length > limit) {
    let cut = remaining.lastIndexOf('\n', limit);
    if (cut < Math.floor(limit * 0.6)) {
      cut = remaining.lastIndexOf(' ', limit);
    }
    if (cut < Math.floor(limit * 0.6)) {
      cut = limit;
    }

    parts.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }

  if (remaining) parts.push(remaining);
  return parts;
}

async function replaceOrReplyLong(ctx, placeholderId, text, extra) {
  const parts = splitMessage(text);
  if (parts.length === 0) return;

  await replaceOrReply(ctx, placeholderId, parts[0], parts.length === 1 ? extra : undefined);

  for (let i = 1; i < parts.length; i++) {
    const partExtra = i === parts.length - 1 ? extra : undefined;
    await ctx.reply(parts[i], partExtra);
  }
}

async function handleGuestMessage(ctx, text) {
  const queued = enqueueUserRequest(ctx.from.id, async () => {
    const allowGreeting = await shouldAllowGreeting(ctx.from.id);

    if (GUEST_RATE_LIMIT > 0) {
      let rl;
      try {
        rl = await checkAndIncrementUserRateLimit(ctx.from.id, GUEST_RATE_LIMIT);
      } catch (error) {
        console.error(`[RATE_LIMIT] user_id=${ctx.from.id} error=${error.message}`);
        return ctx.reply('Сервис временно недоступен. Попробуйте чуть позже.');
      }
      if (!rl.allowed) {
        auditBestEffort('rate_limit_exceeded', {
          severity: 'warning',
          actorUserId: ctx.from.id,
          meta: { flow: 'guest', limit: GUEST_RATE_LIMIT },
        });
        return ctx.reply('Лимит запросов исчерпан. Попробуйте через час.');
      }
    }

    const typingTimer = startTypingLoop(ctx);
    const placeholder = await ctx.reply(PLACEHOLDER_TEXT).catch(() => null);
    const placeholderId = placeholder?.message_id;

    try {
      const history = (ctx.session.message_history || []).slice(-HISTORY_PAIRS * 2);
      const { text: rawAnswer, warning, count } = await askConsultant(text, history);
      const answer = stripGreetingPrefix(rawAnswer, allowGreeting);

      const full = `${answer}\n\n${accessCta(ctx.from.id)}`;
      await replaceOrReplyLong(ctx, placeholderId, full);

      ctx.session.message_history = [
        ...history,
        { role: 'user', text },
        { role: 'model', text: answer },
      ].slice(-HISTORY_PAIRS * 2);

      auditBestEffort('assistant_response_sent', {
        actorUserId: ctx.from.id,
        meta: { flow: 'guest', agentType: 'consultant' },
      });

      if (warning) await notifyOwner(ctx, count ?? '~80%');
    } catch (e) {
      console.error(`[CONSULTANT] user_id=${ctx.from.id} error=${e.message}`);
      const msg = ERROR_MESSAGES[e.message] || 'Ошибка при обработке запроса.';
      await replaceOrReply(ctx, placeholderId, msg);
    } finally {
      clearInterval(typingTimer);
    }
  });

  if (!queued.accepted) {
    auditBestEffort('concurrent_request_blocked', {
      severity: 'warning',
      actorUserId: ctx.from.id,
      meta: { flow: 'guest', queueSize: queued.queueSize },
    });
    return ctx.reply('Слишком много сообщений подряд. Дождитесь ответа и попробуйте ещё раз.');
  }
  return queued.promise;
}

export function messageHandler(bot) {
  bot.command('reset', async (ctx) => {
    if (ctx.isGuest) return;
    await ctx.reply('Выберите агента:', AGENTS_KEYBOARD);
  });

  bot.command('new', async (ctx) => {
    if (ctx.isGuest) return;
    ctx.session.message_history = [];
    await clearSessionHistory(ctx.from.id).catch(() => {});
    const agent = ctx.session?.selected_agent;
    const label = agent ? `${AGENT_ICONS[agent]} ${AGENT_NAMES[agent]}` : 'текущим агентом';
    await ctx.reply(`🆕 Новый диалог с ${label}.`, CONTROL_KEYBOARD);
  });

  bot.on('text', async (ctx) => {
    const text = ctx.message.text;
    if (!text || text.startsWith('/')) return;

    if (text.length > MAX_MESSAGE_LENGTH) {
      auditBestEffort('message_too_long', {
        severity: 'warning',
        actorUserId: ctx.from.id,
        meta: { length: text.length },
      });
      return ctx.reply('Сообщение слишком длинное. Максимум 4000 символов.');
    }

    if (ctx.isGuest) {
      return handleGuestMessage(ctx, text);
    }

    const agentType = ctx.session?.selected_agent;
    if (!agentType || !AGENT_DISPATCH[agentType]) {
      return ctx.reply('Сначала выберите агента:', AGENTS_KEYBOARD);
    }

    const queued = enqueueUserRequest(ctx.from.id, async () => {
      const allowGreeting = await shouldAllowGreeting(ctx.from.id);

      let rl;
      try {
        rl = await checkAndIncrementUserRateLimit(ctx.from.id);
      } catch (error) {
        console.error(`[RATE_LIMIT] user_id=${ctx.from.id} error=${error.message}`);
        return ctx.reply('Сервис временно недоступен. Попробуйте чуть позже.');
      }
      if (!rl.allowed) {
        auditBestEffort('rate_limit_exceeded', {
          severity: 'warning',
          actorUserId: ctx.from.id,
          meta: { flow: 'agent', agentType },
        });
        return ctx.reply('Лимит запросов исчерпан. Попробуйте через час.');
      }

      const typingTimer = startTypingLoop(ctx);
      const placeholder = await ctx.reply(PLACEHOLDER_TEXT).catch(() => null);
      const placeholderId = placeholder?.message_id;

      try {
        const history = (ctx.session.message_history || []).slice(-HISTORY_PAIRS * 2);
        const ask = AGENT_DISPATCH[agentType];
        const { text: rawAnswer, warning, count, noContext } = await ask(text, history);
        const answer = stripGreetingPrefix(rawAnswer, allowGreeting);

        const prefix = noContext ? 'ℹ️ Ответ без контекста из базы знаний.\n\n' : '';
        const suffix = DONT_KNOW_RE.test(answer) ? `\n\n${OWNER_FALLBACK}` : '';
        await replaceOrReplyLong(ctx, placeholderId, prefix + answer + suffix, CONTROL_KEYBOARD);

        ctx.session.message_history = [
          ...history,
          { role: 'user', text },
          { role: 'model', text: answer },
        ].slice(-HISTORY_PAIRS * 2);

        auditBestEffort('assistant_response_sent', {
          actorUserId: ctx.from.id,
          meta: { flow: 'agent', agentType },
        });

        if (warning) await notifyOwner(ctx, count ?? '~80%');
      } catch (e) {
        console.error(`[AGENT] user_id=${ctx.from.id} agent=${agentType} error=${e.message}`);
        console.error('[AGENT] stack:', e.stack);
        if (e.cause) console.error('[AGENT] cause:', e.cause);
        const msg = ERROR_MESSAGES[e.message] || 'Ошибка при обработке запроса.';
        await replaceOrReply(ctx, placeholderId, msg);
      } finally {
        clearInterval(typingTimer);
      }
    });

    if (!queued.accepted) {
      auditBestEffort('concurrent_request_blocked', {
        severity: 'warning',
        actorUserId: ctx.from.id,
        meta: { flow: 'agent', agentType, queueSize: queued.queueSize },
      });
      return ctx.reply('Слишком много сообщений подряд. Дождитесь ответа и попробуйте ещё раз.');
    }
    return queued.promise;
  });
}

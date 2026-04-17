import { askMarketer } from '../../agents/marketer.js';
import { askCopywriter } from '../../agents/copywriter.js';
import { askAds } from '../../agents/ads.js';
import { askPackager } from '../../agents/packager.js';
import { askConsultant } from '../../agents/consultant.js';
import { checkAndIncrementUserRateLimit, clearSessionHistory } from '../../db/queries.js';
import { AGENTS_KEYBOARD, CONTROL_KEYBOARD, AGENT_ICONS, AGENT_NAMES, OWNER_USERNAME } from './agent.js';

const MAX_MESSAGE_LENGTH = 4000;
const HISTORY_PAIRS = 10;

const AGENT_DISPATCH = {
  marketer: askMarketer,
  copywriter: askCopywriter,
  ads: askAds,
  packager: askPackager,
};

const DONT_KNOW_RE = /не могу помочь|не знаю/i;
const OWNER_FALLBACK = `По этому вопросу напишите владельцу: ${OWNER_USERNAME}`;

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

async function handleGuestMessage(ctx, text) {
  const rl = await checkAndIncrementUserRateLimit(ctx.from.id).catch(() => ({ allowed: true }));
  if (!rl.allowed) {
    return ctx.reply('Лимит запросов исчерпан. Попробуйте через час.');
  }

  const typingTimer = startTypingLoop(ctx);
  const placeholder = await ctx.reply(PLACEHOLDER_TEXT).catch(() => null);
  const placeholderId = placeholder?.message_id;

  try {
    const history = (ctx.session.message_history || []).slice(-HISTORY_PAIRS * 2);
    const { text: answer, warning, count } = await askConsultant(text, history);

    const full = `${answer}\n\n${accessCta(ctx.from.id)}`;
    await replaceOrReply(ctx, placeholderId, full);

    ctx.session.message_history = [
      ...history,
      { role: 'user', text },
      { role: 'model', text: answer },
    ].slice(-HISTORY_PAIRS * 2);

    if (warning) await notifyOwner(ctx, count ?? '~80%');
  } catch (e) {
    console.error(`[CONSULTANT] user_id=${ctx.from.id} error=${e.message}`);
    const msg = ERROR_MESSAGES[e.message] || 'Ошибка при обработке запроса.';
    await replaceOrReply(ctx, placeholderId, msg);
  } finally {
    clearInterval(typingTimer);
  }
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
      return ctx.reply('Сообщение слишком длинное. Максимум 4000 символов.');
    }

    if (ctx.isGuest) {
      return handleGuestMessage(ctx, text);
    }

    const agentType = ctx.session?.selected_agent;
    if (!agentType || !AGENT_DISPATCH[agentType]) {
      return ctx.reply('Сначала выберите агента:', AGENTS_KEYBOARD);
    }

    const rl = await checkAndIncrementUserRateLimit(ctx.from.id).catch(() => ({ allowed: true }));
    if (!rl.allowed) {
      return ctx.reply('Лимит запросов исчерпан. Попробуйте через час.');
    }

    const typingTimer = startTypingLoop(ctx);
    const placeholder = await ctx.reply(PLACEHOLDER_TEXT).catch(() => null);
    const placeholderId = placeholder?.message_id;

    try {
      const history = (ctx.session.message_history || []).slice(-HISTORY_PAIRS * 2);
      const ask = AGENT_DISPATCH[agentType];
      const { text: answer, warning, count, noContext } = await ask(text, history);

      const prefix = noContext ? 'ℹ️ Ответ без контекста из базы знаний.\n\n' : '';
      const suffix = DONT_KNOW_RE.test(answer) ? `\n\n${OWNER_FALLBACK}` : '';
      await replaceOrReply(ctx, placeholderId, prefix + answer + suffix, CONTROL_KEYBOARD);

      ctx.session.message_history = [
        ...history,
        { role: 'user', text },
        { role: 'model', text: answer },
      ].slice(-HISTORY_PAIRS * 2);

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
}

import { askMarketer } from '../../agents/marketer.js';
import { askCopywriter } from '../../agents/copywriter.js';
import { askAds } from '../../agents/ads.js';
import { askPackager } from '../../agents/packager.js';
import { checkAndIncrementUserRateLimit, clearSessionHistory } from '../../db/queries.js';
import { AGENTS_KEYBOARD, AGENT_NAMES } from './agent.js';

const MAX_MESSAGE_LENGTH = 4000;
const HISTORY_PAIRS = 10;

const AGENT_DISPATCH = {
  marketer: askMarketer,
  copywriter: askCopywriter,
  ads: askAds,
  packager: askPackager,
};

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
      `Внимание: использовано ${count}/${limit} запросов Gemini API за сегодня.`
    );
  } catch (_) {}
}

export function messageHandler(bot) {
  bot.command('reset', async (ctx) => {
    ctx.session.message_history = [];
    await clearSessionHistory(ctx.from.id).catch(() => {});
    await ctx.reply('Контекст диалога очищен.');
  });

  bot.command('new', async (ctx) => {
    ctx.session.message_history = [];
    await ctx.reply('Новый диалог начат. Агент сохранён.');
  });

  bot.on('text', async (ctx) => {
    const text = ctx.message.text;
    if (!text || text.startsWith('/')) return;

    if (text.length > MAX_MESSAGE_LENGTH) {
      return ctx.reply('Сообщение слишком длинное. Максимум 4000 символов.');
    }

    const agentType = ctx.session?.selected_agent;
    if (!agentType || !AGENT_DISPATCH[agentType]) {
      return ctx.reply('Сначала выберите агента:', AGENTS_KEYBOARD);
    }

    const rl = await checkAndIncrementUserRateLimit(ctx.from.id).catch(() => ({ allowed: true }));
    if (!rl.allowed) {
      return ctx.reply('Лимит запросов исчерпан. Попробуйте через час.');
    }

    await ctx.sendChatAction('typing').catch(() => {});

    try {
      const history = (ctx.session.message_history || []).slice(-HISTORY_PAIRS * 2);
      const ask = AGENT_DISPATCH[agentType];
      const { text: answer, warning, noContext } = await ask(text, history);

      const prefix = noContext ? '(ответ без контекста из базы знаний)\n\n' : '';
      await ctx.reply(prefix + answer);

      ctx.session.message_history = [
        ...history,
        { role: 'user', text },
        { role: 'model', text: answer },
      ].slice(-HISTORY_PAIRS * 2);

      if (warning) await notifyOwner(ctx, warning.count || '~80%');
    } catch (e) {
      console.error(`[AGENT] user_id=${ctx.from.id} agent=${agentType} error=${e.message}`);
      const msg = ERROR_MESSAGES[e.message] || 'Ошибка при обработке запроса.';
      await ctx.reply(msg);
    }
  });
}

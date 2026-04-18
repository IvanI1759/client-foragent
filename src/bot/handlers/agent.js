import { Markup } from 'telegraf';
import { clearSessionHistory } from '../../db/queries.js';

const VALID_AGENTS = ['marketer', 'copywriter', 'ads', 'packager'];

const AGENT_NAMES = {
  marketer: 'Маркетолог',
  copywriter: 'Копирайтер',
  ads: 'Директолог (РСЯ)',
  packager: 'Упаковщик',
};

const AGENT_ICONS = {
  marketer: '📊',
  copywriter: '✍️',
  ads: '📣',
  packager: '📦',
};

const OWNER_USERNAME = '@Skyter2026';

const AGENTS_KEYBOARD = Markup.inlineKeyboard([
  [
    Markup.button.callback('📊 Маркетолог', 'agent:marketer'),
    Markup.button.callback('✍️ Копирайтер', 'agent:copywriter'),
  ],
  [
    Markup.button.callback('📣 Директолог (РСЯ)', 'agent:ads'),
    Markup.button.callback('📦 Упаковщик', 'agent:packager'),
  ],
  [Markup.button.callback('❓ Помощь', 'action:help')],
]);

const CONTROL_KEYBOARD = Markup.inlineKeyboard([
  [
    Markup.button.callback('🔄 Сменить', 'action:switch'),
    Markup.button.callback('🧹 Сбросить', 'action:reset'),
    Markup.button.callback('🆕 Новый', 'action:new'),
  ],
]);

const HELP_TEXT =
  'ℹ️ Как пользоваться:\n\n' +
  '1. Выберите агента кнопкой ниже.\n' +
  '2. Задайте вопрос обычным сообщением.\n' +
  '3. Используйте панель управления под ответами:\n' +
  '   🔄 Сменить - переключить агента\n' +
  '   🧹 Сбросить - очистить историю диалога\n' +
  '   🆕 Новый - начать новый диалог с тем же агентом\n\n' +
  'Агенты:\n' +
  '📊 Маркетолог - стратегия, ЦА, воронки\n' +
  '✍️ Копирайтер - тексты, посты, рассылки\n' +
  '📣 Директолог (РСЯ) - объявления, таргетинг в РСЯ/Яндекс.Директ\n' +
  '📦 Упаковщик - оформление Telegram-канала, УТП';

function guestBlocked(ctx) {
  if (!ctx.isGuest) return false;
  const id = ctx.from?.id;
  ctx.answerCbQuery?.('Доступ только для партнёров').catch(() => {});
  ctx.reply(
    `Эта функция доступна партнёрам проекта.\n\n` +
    `Хотите получить доступ? Ваш ID: ${id}\n` +
    `Отправьте его ${OWNER_USERNAME}`
  ).catch(() => {});
  return true;
}

export function agentHandler(bot) {
  // Выбор агента
  bot.action(/^agent:(.+)$/, async (ctx) => {
    if (guestBlocked(ctx)) return;
    const choice = ctx.match[1];
    if (!VALID_AGENTS.includes(choice)) {
      return ctx.answerCbQuery('Неизвестный агент');
    }

    ctx.session.selected_agent = choice;
    ctx.session.message_history = [];
    await clearSessionHistory(ctx.from.id).catch(() => {});

    await ctx.answerCbQuery(`${AGENT_ICONS[choice]} ${AGENT_NAMES[choice]}`);
    await ctx.editMessageText(
      `${AGENT_ICONS[choice]} Агент: ${AGENT_NAMES[choice]}\n\nЗадайте вопрос сообщением.`,
      CONTROL_KEYBOARD
    );
  });

  // Смена агента - показать меню
  bot.action('action:switch', async (ctx) => {
    if (guestBlocked(ctx)) return;
    await ctx.answerCbQuery();
    await ctx.reply('Выберите агента:', AGENTS_KEYBOARD);
  });

  // Сброс истории
  bot.action('action:reset', async (ctx) => {
    if (guestBlocked(ctx)) return;
    ctx.session.message_history = [];
    await clearSessionHistory(ctx.from.id).catch(() => {});
    await ctx.answerCbQuery('История очищена');
    await ctx.reply('🧹 История диалога очищена.', CONTROL_KEYBOARD);
  });

  // Новый диалог (агент сохранён)
  bot.action('action:new', async (ctx) => {
    if (guestBlocked(ctx)) return;
    ctx.session.message_history = [];
    await clearSessionHistory(ctx.from.id).catch(() => {});
    const agent = ctx.session.selected_agent;
    const label = agent ? `${AGENT_ICONS[agent]} ${AGENT_NAMES[agent]}` : 'текущим агентом';
    await ctx.answerCbQuery('Новый диалог');
    await ctx.reply(`🆕 Новый диалог с ${label}.`, CONTROL_KEYBOARD);
  });

  // Помощь
  bot.action('action:help', async (ctx) => {
    await ctx.answerCbQuery();
    if (ctx.isGuest) {
      await ctx.reply(
        `Я могу рассказать о проекте. Задайте вопрос.\n\n` +
        `Хотите получить доступ? Ваш ID: ${ctx.from.id}\n` +
        `Отправьте его ${OWNER_USERNAME}`
      );
      return;
    }
    await ctx.reply(HELP_TEXT, AGENTS_KEYBOARD);
  });

}

export {
  AGENTS_KEYBOARD,
  CONTROL_KEYBOARD,
  AGENT_NAMES,
  AGENT_ICONS,
  VALID_AGENTS,
  HELP_TEXT,
  OWNER_USERNAME,
};

import { Markup } from 'telegraf';
import { clearSessionHistory } from '../../db/queries.js';
import { isAdmin } from '../admins.js';

const VALID_AGENTS = ['marketer', 'copywriter', 'ads', 'packager'];
const OWNER_AGENT = 'strategist';
const OWNER_AGENTS = [OWNER_AGENT];
const ALL_AGENTS = [...VALID_AGENTS, ...OWNER_AGENTS];

const AGENT_NAMES = {
  marketer: 'Маркетолог',
  copywriter: 'Копирайтер',
  ads: 'Директолог (РСЯ)',
  packager: 'Упаковщик',
  strategist: 'Стратег',
};

const AGENT_ICONS = {
  marketer: '📊',
  copywriter: '✍️',
  ads: '📣',
  packager: '📦',
  strategist: '🧠',
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

function getAgentsKeyboard(ctx) {
  const rows = [
    [
      Markup.button.callback('📊 Маркетолог', 'agent:marketer'),
      Markup.button.callback('✍️ Копирайтер', 'agent:copywriter'),
    ],
    [
      Markup.button.callback('📣 Директолог (РСЯ)', 'agent:ads'),
      Markup.button.callback('📦 Упаковщик', 'agent:packager'),
    ],
  ];

  if (isAdmin(ctx)) {
    rows.push([Markup.button.callback('🧠 Стратег', 'agent:strategist')]);
  }

  rows.push([Markup.button.callback('❓ Помощь', 'action:help')]);
  return Markup.inlineKeyboard(rows);
}

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
  '2. Задайте вопрос или отправьте файл (PDF, DOCX, TXT).\n' +
  '3. Используйте панель управления под ответами:\n' +
  '   🔄 Сменить - переключить агента\n' +
  '   🧹 Сбросить - очистить историю диалога\n' +
  '   🆕 Новый - начать новый диалог с тем же агентом\n\n' +
  'Кого выбрать:\n\n' +
  '📊 Маркетолог - если нужно:\n' +
  '   - понять свою аудиторию и её боли\n' +
  '   - выстроить стратегию продвижения\n' +
  '   - разобраться с воронкой и трафиком\n\n' +
  '✍️ Копирайтер - если нужно:\n' +
  '   - написать пост, статью или рассылку\n' +
  '   - переработать готовый текст\n' +
  '   - придумать цепляющий заголовок\n\n' +
  '📣 Директолог (РСЯ) - если нужно:\n' +
  '   - создать объявления для Яндекс.Директ или РСЯ\n' +
  '   - подобрать ключевые слова и аудитории\n' +
  '   - улучшить CTR и снизить стоимость клика\n\n' +
  '📦 Упаковщик - если нужно:\n' +
  '   - оформить Telegram-канал (название, описание, закреп)\n' +
  '   - сформулировать оффер и УТП\n' +
  '   - провести анализ целевой аудитории по документам';

const AGENT_WELCOME = {
  marketer:
    '📊 Агент: Маркетолог\n\n' +
    'Чем помогу:\n' +
    '- анализ целевой аудитории и её болей\n' +
    '- стратегия продвижения и позиционирования\n' +
    '- воронки, трафик, каналы привлечения\n\n' +
    'Задайте вопрос или загрузите файл с материалами проекта.',
  copywriter:
    '✍️ Агент: Копирайтер\n\n' +
    'Чем помогу:\n' +
    '- написать пост, статью, рассылку с нуля\n' +
    '- переработать и усилить готовый текст\n' +
    '- придумать заголовки и цепляющие фразы\n\n' +
    'Опишите задачу или загрузите текст для доработки.',
  ads:
    '📣 Агент: Директолог (РСЯ)\n\n' +
    'Чем помогу:\n' +
    '- создать объявления для Яндекс.Директ и РСЯ\n' +
    '- подобрать ключевые слова и аудитории\n' +
    '- улучшить CTR и снизить стоимость клика\n\n' +
    'Опишите продукт или загрузите файл с описанием.',
  packager:
    '📦 Агент: Упаковщик\n\n' +
    'Чем помогу:\n' +
    '- оформить Telegram-канал (название, описание, закреп)\n' +
    '- сформулировать оффер и УТП\n' +
    '- провести глубокий анализ ЦА по вашим материалам\n\n' +
    'Задайте вопрос или загрузите документы с данными о проекте.',
  strategist:
    '🧠 Агент: Стратег\n\n' +
    'Чем помогу:\n' +
    '- общий анализ проекта и слабых мест\n' +
    '- идеи для роста и развития\n' +
    '- стратегические решения по проекту\n\n' +
    'Задайте вопрос.',
};

function getHelpText(ctx) {
  if (!isAdmin(ctx)) return HELP_TEXT;
  return HELP_TEXT + '\n\n' +
    '🧠 Стратег - если нужно:\n' +
    '   - получить общий взгляд на проект\n' +
    '   - найти слабые места и точки роста\n' +
    '   - стратегический совет по развитию';
}

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
    if (!ALL_AGENTS.includes(choice)) {
      return ctx.answerCbQuery('Неизвестный агент');
    }
    if (OWNER_AGENTS.includes(choice) && !isAdmin(ctx)) {
      return ctx.answerCbQuery('Этот агент доступен только владельцу');
    }

    ctx.session.selected_agent = choice;
    ctx.session.message_history = [];
    await clearSessionHistory(ctx.from.id).catch(() => {});

    await ctx.answerCbQuery(`${AGENT_ICONS[choice]} ${AGENT_NAMES[choice]}`);
    await ctx.editMessageText(
      AGENT_WELCOME[choice] || `${AGENT_ICONS[choice]} Агент: ${AGENT_NAMES[choice]}\n\nЗадайте вопрос сообщением.`,
      CONTROL_KEYBOARD
    );
  });

  // Смена агента - показать меню
  bot.action('action:switch', async (ctx) => {
    if (guestBlocked(ctx)) return;
    await ctx.answerCbQuery();
    await ctx.reply('Выберите агента:', getAgentsKeyboard(ctx));
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
    await ctx.reply(getHelpText(ctx), getAgentsKeyboard(ctx));
  });

}

export {
  AGENTS_KEYBOARD,
  getAgentsKeyboard,
  CONTROL_KEYBOARD,
  AGENT_NAMES,
  AGENT_ICONS,
  VALID_AGENTS,
  HELP_TEXT,
  getHelpText,
  OWNER_USERNAME,
};

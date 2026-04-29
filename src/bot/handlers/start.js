import { getAgentsKeyboard, getHelpText, OWNER_USERNAME } from './agent.js';

export function startHandler(bot) {
  bot.start(async (ctx) => {
    console.log(`[START] user_id=${ctx.from.id} guest=${Boolean(ctx.isGuest)}`);

    if (ctx.isGuest) {
      await ctx.reply(
        '👋 Привет!\n\n' +
        '🤖 Это приватный AI-ассистент для партнёров проекта.\n\n' +
        '💡 Я могу рассказать о проекте и о том, что получают партнёры.\n' +
        'Задайте вопрос обычным сообщением.\n\n' +
        `🔑 Хотите получить доступ? Ваш ID: ${ctx.from.id}\n` +
        `Отправьте его ${OWNER_USERNAME}`
      );
      return;
    }

    await ctx.reply(
      '👋 Добро пожаловать!\n\n' +
      '🤖 Я - AI-ассистент со специализированными агентами:\n\n' +
      '📊 Маркетолог - стратегия, ЦА, воронки\n' +
      '✍️ Копирайтер - тексты, посты, рассылки\n' +
      '📣 Директолог (РСЯ) - объявления, таргетинг в РСЯ/Яндекс.Директ\n' +
      '📦 Упаковщик - офферы, УТП, Telegram-канал\n' +
      (ctx.isAdmin ? '🧠 Стратег - личный советник владельца\n' : '') +
      '\n' +
      '👇 Выберите агента:',
      getAgentsKeyboard(ctx)
    );
  });

  bot.help(async (ctx) => {
    if (ctx.isGuest) {
      await ctx.reply(
        '💡 Я могу рассказать о проекте. Задайте вопрос.\n\n' +
        `🔑 Хотите получить доступ? Ваш ID: ${ctx.from.id}\n` +
        `Отправьте его ${OWNER_USERNAME}`
      );
      return;
    }
    await ctx.reply(getHelpText(ctx), getAgentsKeyboard(ctx));
  });
}

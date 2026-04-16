import { Markup } from 'telegraf';

const VALID_AGENTS = ['marketer', 'copywriter', 'ads', 'packager'];

const AGENT_NAMES = {
  marketer: 'Маркетолог',
  copywriter: 'Копирайтер',
  ads: 'Рекламщик (РСЯ)',
  packager: 'Упаковщик Telegram-канала',
};

const AGENTS_KEYBOARD = Markup.inlineKeyboard([
  [
    Markup.button.callback('Маркетолог', 'agent:marketer'),
    Markup.button.callback('Копирайтер', 'agent:copywriter'),
  ],
  [
    Markup.button.callback('Рекламщик', 'agent:ads'),
    Markup.button.callback('Упаковщик', 'agent:packager'),
  ],
]);

export function agentHandler(bot) {
  bot.action(/^agent:(.+)$/, async (ctx) => {
    const choice = ctx.match[1];
    if (!VALID_AGENTS.includes(choice)) {
      return ctx.answerCbQuery('Неизвестный агент');
    }

    ctx.session.selected_agent = choice;
    ctx.session.message_history = [];

    await ctx.answerCbQuery();
    await ctx.editMessageText(
      `Агент: ${AGENT_NAMES[choice]}.\n\nЗадайте вопрос. /switch — сменить агента, /reset — очистить историю.`
    );
  });

  bot.command('switch', async (ctx) => {
    await ctx.reply('Выберите агента:', AGENTS_KEYBOARD);
  });
}

export { AGENTS_KEYBOARD, AGENT_NAMES, VALID_AGENTS };

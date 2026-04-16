import { Markup } from 'telegraf';

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

export function startHandler(bot) {
  bot.start((ctx) => {
    console.log(`[START] user_id=${ctx.from.id}`);

    ctx.reply(
      'Добро пожаловать! Я — AI-ассистент с 4 специализированными агентами.\n\n' +
      '**Маркетолог** — стратегия, анализ рынка, ЦА\n' +
      '**Копирайтер** — тексты, посты, рассылки\n' +
      '**Рекламщик** — объявления, таргетинг\n' +
      '**Упаковщик** — офферы, УТП, продуктовые страницы\n\n' +
      'Выберите агента:',
      { parse_mode: 'Markdown', ...AGENTS_KEYBOARD }
    );
  });

  bot.help((ctx) => {
    ctx.reply(
      '**Команды:**\n\n' +
      '/start — Главное меню\n' +
      '/switch — Сменить агента\n' +
      '/reset — Очистить историю диалога\n' +
      '/new — Начать новый диалог\n' +
      '/help — Эта справка\n\n' +
      '**Для владельца:**\n' +
      '/grant {user\\_id} — Выдать доступ\n' +
      '/revoke {user\\_id} — Отозвать доступ\n' +
      '/users — Список пользователей\n' +
      '/status — Статистика\n' +
      '/upload — Загрузить документ (отправить файл)',
      { parse_mode: 'Markdown' }
    );
  });
}

export { AGENTS_KEYBOARD };

import 'dotenv/config';
import express from 'express';
import { Telegraf } from 'telegraf';
import authMiddleware from './src/bot/middleware/auth.js';
import sessionMiddleware from './src/bot/middleware/session.js';
import { startHandler } from './src/bot/handlers/start.js';
import { adminHandler } from './src/bot/handlers/admin.js';
import { agentHandler } from './src/bot/handlers/agent.js';
import { messageHandler } from './src/bot/handlers/message.js';

const { BOT_TOKEN, WEBHOOK_URL, WEBHOOK_SECRET, PORT = '3000' } = process.env;

if (!BOT_TOKEN) throw new Error('Missing BOT_TOKEN');

const useWebhook = Boolean(WEBHOOK_URL);
if (useWebhook && !WEBHOOK_SECRET) throw new Error('Missing WEBHOOK_SECRET');

const bot = new Telegraf(BOT_TOKEN);
const app = express();

// Health check
app.get('/health', (_req, res) => res.sendStatus(200));

// Webhook with secret token validation (prod only)
if (useWebhook) {
  app.use(bot.webhookCallback('/webhook', { secretToken: WEBHOOK_SECRET }));
}

// Middleware: only private chats
bot.use(async (ctx, next) => {
  if (ctx.chat?.type !== 'private') return;
  return next();
});

// Middleware: auth → session
bot.use(authMiddleware);
bot.use(sessionMiddleware);

// Handlers (order matters: commands before text)
startHandler(bot);
adminHandler(bot);
agentHandler(bot);
messageHandler(bot);

const PUBLIC_COMMANDS = [
  { command: 'start', description: 'Главное меню' },
  { command: 'help', description: 'Описание агентов' },
  { command: 'reset', description: 'Сменить агента' },
  { command: 'new', description: 'Начать новый диалог (очистить историю)' },
];

const OWNER_ONLY_COMMANDS = [
  { command: 'grant', description: 'Выдать доступ партнёру' },
  { command: 'revoke', description: 'Отозвать доступ' },
  { command: 'users', description: 'Список партнёров' },
  { command: 'stats', description: 'Статистика использования' },
  { command: 'upload', description: 'Загрузить документ в базу знаний' },
];

const OWNER_COMMANDS = [...PUBLIC_COMMANDS, ...OWNER_ONLY_COMMANDS];

function getAdminIds() {
  const owner = process.env.OWNER_CHAT_ID;
  const admins = (process.env.ADMIN_CHAT_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return [...new Set([owner, ...admins].filter(Boolean))];
}

async function registerCommandScopes() {
  // Default scope - все пользователи видят 4 публичные команды
  await bot.telegram.setMyCommands(PUBLIC_COMMANDS, {
    scope: { type: 'default' },
  });

  // Chat scope - владелец и администраторы видят расширенный набор
  for (const id of getAdminIds()) {
    await bot.telegram.setMyCommands(OWNER_COMMANDS, {
      scope: { type: 'chat', chat_id: Number(id) },
    });
  }
}

// Launch
const server = app.listen(Number(PORT), async () => {
  try {
    await registerCommandScopes();
  } catch (e) {
    console.error(`[BOOT] setMyCommands error: ${e.message}`);
  }

  if (useWebhook) {
    await bot.telegram.setWebhook(`${WEBHOOK_URL}/webhook`, {
      secret_token: WEBHOOK_SECRET,
    });
    console.log(`[BOOT] Bot running on port ${PORT}, webhook set`);
  } else {
    await bot.telegram.deleteWebhook();
    bot.launch();
    console.log(`[BOOT] Bot running on port ${PORT}, long polling`);
  }
});

// Graceful shutdown
const shutdown = (signal) => {
  console.log(`[SHUTDOWN] ${signal} received`);
  server.close();
  bot.stop(signal);
  process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

import 'dotenv/config';
import express from 'express';
import { Telegraf } from 'telegraf';
import authMiddleware from './src/bot/middleware/auth.js';
import sessionMiddleware from './src/bot/middleware/session.js';
import { startHandler } from './src/bot/handlers/start.js';
import { adminHandler } from './src/bot/handlers/admin.js';
import { agentHandler } from './src/bot/handlers/agent.js';
import { messageHandler } from './src/bot/handlers/message.js';
import { getAdminIds } from './src/bot/admins.js';
import { checkSupabaseConnection } from './src/db/queries.js';

const { BOT_TOKEN, WEBHOOK_URL, WEBHOOK_SECRET, PORT = '3000' } = process.env;

if (!BOT_TOKEN) throw new Error('Missing BOT_TOKEN');

const useWebhook = Boolean(WEBHOOK_URL);
if (useWebhook && !WEBHOOK_SECRET) throw new Error('Missing WEBHOOK_SECRET');

const webhookBase = useWebhook ? WEBHOOK_URL.replace(/\/+$/, '') : '';

const bot = new Telegraf(BOT_TOKEN);
const app = express();

function formatError(error) {
  if (error instanceof Error) return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

bot.catch((err, ctx) => {
  const updateType = ctx?.updateType ?? 'unknown';
  const userId = ctx?.from?.id ?? 'unknown';
  console.error(`[BOT] update=${updateType} user_id=${userId} error=${formatError(err)}`);
});

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
  { command: 'list_docs', description: 'Список документов в базе знаний' },
  { command: 'delete_doc', description: 'Удалить документ из базы знаний' },
];

const OWNER_COMMANDS = [...PUBLIC_COMMANDS, ...OWNER_ONLY_COMMANDS];

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
  const adminIds = getAdminIds();
  const owner = (process.env.OWNER_CHAT_ID || '').trim() || '(not set)';
  const admins = adminIds.filter((id) => id !== owner);
  console.log(`[BOOT] OWNER_CHAT_ID=${owner}`);
  console.log(`[BOOT] ADMIN_IDS=${admins.length ? admins.join(',') : '(empty)'}`);

  try {
    await checkSupabaseConnection();
    console.log('[BOOT] Supabase connection OK');
  } catch (e) {
    console.error(`[BOOT] Supabase connection FAILED: ${formatError(e)}`);
    console.warn('[BOOT] Sessions will use in-memory fallback until Supabase is reachable');
  }

  try {
    await registerCommandScopes();
  } catch (e) {
    console.error(`[BOOT] setMyCommands error: ${e.message}`);
  }

  try {
    if (useWebhook) {
      const targetWebhook = `${webhookBase}/webhook`;
      console.log(`[BOOT] Setting webhook to ${targetWebhook}`);
      await bot.telegram.setWebhook(targetWebhook, {
        secret_token: WEBHOOK_SECRET,
      });
      const info = await bot.telegram.getWebhookInfo();
      console.log(
        `[BOOT] Telegram webhook=${info.url || '(empty)'} pending=${info.pending_update_count ?? 0}` +
        (info.last_error_message ? ` last_error="${info.last_error_message}"` : '')
      );
      console.log(`[BOOT] Bot running on port ${PORT}, webhook set`);
    } else {
      await bot.telegram.deleteWebhook();
      bot.launch();
      console.log(`[BOOT] Bot running on port ${PORT}, long polling`);
    }
  } catch (e) {
    console.error(`[BOOT] launch error: ${formatError(e)}`);
  }
});

process.on('unhandledRejection', (reason) => {
  console.error(`[FATAL] Unhandled rejection: ${formatError(reason)}`);
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

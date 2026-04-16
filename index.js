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
if (!WEBHOOK_URL) throw new Error('Missing WEBHOOK_URL');
if (!WEBHOOK_SECRET) throw new Error('Missing WEBHOOK_SECRET');

const bot = new Telegraf(BOT_TOKEN);
const app = express();

// Health check
app.get('/health', (_req, res) => res.sendStatus(200));

// Webhook with secret token validation
app.use(bot.webhookCallback('/webhook', { secretToken: WEBHOOK_SECRET }));

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

// Launch
const server = app.listen(Number(PORT), async () => {
  await bot.telegram.setWebhook(`${WEBHOOK_URL}/webhook`, {
    secret_token: WEBHOOK_SECRET,
  });
  console.log(`[BOOT] Bot running on port ${PORT}, webhook set`);
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

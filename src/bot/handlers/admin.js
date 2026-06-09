import { Markup } from 'telegraf';
import {
  grantAccess,
  revokeAccess,
  listActiveUsers,
  deleteDocumentsByFilename,
  deleteDocumentsByFilenameForAgents,
  insertDocumentChunks,
  renameDocuments,
  listDocuments,
  getStats,
  savePendingUpload,
  getPendingUpload,
  deletePendingUpload,
  recordAuditEvent,
} from '../../db/queries.js';
import { invalidateCache } from '../middleware/auth.js';
import { isAdmin } from '../admins.js';
import { ingestFile, sanitizeFilename } from '../../rag/ingest.js';
import { embedChunks } from '../../rag/embed.js';

const VALID_AGENTS = ['marketer', 'copywriter', 'ads', 'packager'];
const UPLOAD_TARGETS = [...VALID_AGENTS, 'consultant'];
const AGENT_NAMES = {
  marketer: 'Маркетолог',
  copywriter: 'Копирайтер',
  ads: 'Директолог (РСЯ)',
  packager: 'Упаковщик',
  consultant: 'Консультант',
};

function logDetailedError(scope, error, extra = {}) {
  const details = {
    message: error?.message,
    code: error?.code,
    status: error?.status,
    details: error?.details,
    hint: error?.hint,
    cause: error?.cause?.message || error?.cause,
    ...extra,
  };
  console.error(`[${scope}]`, details);
  if (error?.stack) {
    console.error(`[${scope}] stack:`, error.stack);
  }
}

function formatErrorDetails(error) {
  const parts = [
    error?.message ? `message=${error.message}` : null,
    error?.code ? `code=${error.code}` : null,
    error?.status ? `status=${error.status}` : null,
    error?.details ? `details=${error.details}` : null,
    error?.hint ? `hint=${error.hint}` : null,
    error?.cause?.message ? `cause=${error.cause.message}` : null,
  ].filter(Boolean);

  return parts.length > 0 ? parts.join('\n') : 'details=none';
}

function auditBestEffort(eventType, options) {
  recordAuditEvent(eventType, options).catch((error) => {
    console.error(`[AUDIT] event=${eventType} error=${error.message}`);
  });
}

function parseUserId(text) {
  const match = text?.match(/^\/\w+\s+(-?\d+)/);
  return match ? Number(match[1]) : null;
}

export async function downloadFile(ctx, fileId) {
  const MAX_ATTEMPTS = 3;
  let lastErr;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const link = await ctx.telegram.getFileLink(fileId);
      const res = await fetch(link.href);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (e) {
      lastErr = e;
      console.error(`[DOWNLOAD] attempt=${attempt}/${MAX_ATTEMPTS} error=${e.message}`);
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, 1000 * attempt));
      }
    }
  }
  throw new Error('FILE_DOWNLOAD_FAILED');
}

const UPLOAD_AGENT_KEYBOARD = Markup.inlineKeyboard([
  [Markup.button.callback('📚 Все агенты', 'upload_agent:all')],
  [
    Markup.button.callback('Маркетолог', 'upload_agent:marketer'),
    Markup.button.callback('Копирайтер', 'upload_agent:copywriter'),
  ],
  [
    Markup.button.callback('Директолог (РСЯ)', 'upload_agent:ads'),
    Markup.button.callback('Упаковщик', 'upload_agent:packager'),
  ],
  [Markup.button.callback('💬 Консультант (о проекте)', 'upload_agent:consultant')],
  [Markup.button.callback('Отмена', 'upload_agent:cancel')],
]);

export function adminHandler(bot) {
  // /grant <user_id>
  bot.command('grant', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const targetId = parseUserId(ctx.message.text);
    if (!targetId) {
      return ctx.reply('Использование: /grant {user_id}');
    }
    try {
      await grantAccess(targetId, ctx.from.id);
      invalidateCache(targetId);
      auditBestEffort('access_granted', {
        severity: 'info',
        actorUserId: ctx.from.id,
        targetUserId: targetId,
      });
      await ctx.reply(`Доступ выдан пользователю ${targetId}`);
    } catch (e) {
      console.error(`[GRANT] user_id=${ctx.from.id} error`);
      await ctx.reply('Ошибка при выдаче доступа');
    }
  });

  // /revoke <user_id>
  bot.command('revoke', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const targetId = parseUserId(ctx.message.text);
    if (!targetId) {
      return ctx.reply('Использование: /revoke {user_id}');
    }
    try {
      const found = await revokeAccess(targetId);
      invalidateCache(targetId);
      if (found) {
        auditBestEffort('access_revoked', {
          severity: 'warning',
          actorUserId: ctx.from.id,
          targetUserId: targetId,
        });
      }
      await ctx.reply(
        found
          ? `Доступ отозван у пользователя ${targetId}`
          : `Пользователь ${targetId} не найден`
      );
    } catch (e) {
      console.error(`[REVOKE] user_id=${ctx.from.id} error`);
      await ctx.reply('Ошибка при отзыве доступа');
    }
  });

  // /users
  bot.command('users', async (ctx) => {
    if (!isAdmin(ctx)) return;
    try {
      const users = await listActiveUsers();
      if (users.length === 0) {
        return ctx.reply('Активных пользователей нет');
      }
      const lines = users.map((u) => {
        const date = u.granted_at ? new Date(u.granted_at).toISOString().split('T')[0] : '-';
        return `• ${u.user_id} (выдан: ${date})`;
      });
      await ctx.reply(`Активные пользователи (${users.length}):\n\n${lines.join('\n')}`);
    } catch (e) {
      console.error(`[USERS] user_id=${ctx.from.id} error`);
      await ctx.reply('Ошибка при получении списка');
    }
  });

  // /stats (и alias /status)
  const statsHandler = async (ctx) => {
    if (!isAdmin(ctx)) return;
    try {
      const s = await getStats();
      const byAgent = Object.entries(s.documents.byAgent)
        .map(([k, v]) => `  ${AGENT_NAMES[k] || k}: ${v}`)
        .join('\n') || '  (нет)';
      await ctx.reply(
        `Статистика:\n\n` +
          `Активных пользователей: ${s.activeUsers}\n` +
          `Документов (чанков): ${s.documents.total}\n${byAgent}\n\n` +
          `API за сегодня: ${s.apiUsage.daily_count} (сброс: ${s.apiUsage.reset_date})`
      );
    } catch (e) {
      console.error(`[STATS] user_id=${ctx.from.id} error`);
      await ctx.reply('Ошибка при получении статистики');
    }
  };
  bot.command('stats', statsHandler);
  bot.command('status', statsHandler);

  // /upload - подсказка; владелец отправляет файл документом
  bot.command('upload', async (ctx) => {
    if (!isAdmin(ctx)) return;
    await ctx.reply('Отправьте файл (PDF, DOCX или TXT, до 10 МБ) как документ.');
  });

  // Приём документа (только владелец)
  bot.on('document', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const doc = ctx.message.document;
    if (!doc) return;
    console.log(
      `[UPLOAD] document_received user_id=${ctx.from.id} file_name=${doc.file_name} file_size=${doc.file_size || 0}`
    );

    if (doc.file_size && doc.file_size > 10 * 1024 * 1024) {
      auditBestEffort('upload_rejected_too_large', {
        severity: 'warning',
        actorUserId: ctx.from.id,
        meta: { filename: doc.file_name, fileSize: doc.file_size },
      });
      return ctx.reply('Файл слишком большой (максимум 10 МБ).');
    }

    await savePendingUpload(
      ctx.from.id,
      doc.file_id,
      doc.file_name || `file_${Date.now()}`
    );
    auditBestEffort('upload_pending_created', {
      severity: 'info',
      actorUserId: ctx.from.id,
      meta: { filename: doc.file_name, fileSize: doc.file_size || 0 },
    });

    await ctx.reply(
      `Файл: ${doc.file_name}\nДля какого агента этот документ?`,
      UPLOAD_AGENT_KEYBOARD
    );
  });

  // Callback выбора агента для upload
  bot.action(/^upload_agent:(.+)$/, async (ctx) => {
    if (!isAdmin(ctx)) return ctx.answerCbQuery();

    const choice = ctx.match[1];
    const pending = await getPendingUpload(ctx.from.id).catch(() => null);

    if (choice === 'cancel') {
      await deletePendingUpload(ctx.from.id).catch(() => {});
      auditBestEffort('upload_cancelled', {
        severity: 'info',
        actorUserId: ctx.from.id,
        meta: { filename: pending?.filename || null },
      });
      await ctx.answerCbQuery('Отменено');
      return ctx.editMessageText('Загрузка отменена.');
    }

    const isAll = choice === 'all';
    if (!isAll && !UPLOAD_TARGETS.includes(choice)) {
      return ctx.answerCbQuery('Неверный агент');
    }
    if (!pending) {
      return ctx.answerCbQuery('Нет файла в ожидании');
    }

    const targetAgents = isAll ? UPLOAD_TARGETS : [choice];
    const targetLabel = isAll
      ? `всех агентов (${UPLOAD_TARGETS.length})`
      : `агента ${AGENT_NAMES[choice]}`;

    console.log(
      `[UPLOAD] selection user_id=${ctx.from.id} filename=${pending.filename} target=${choice} mode=${isAll ? 'all' : 'single'}`
    );
    await ctx.answerCbQuery();
    await ctx.editMessageText(`Обработка файла «${pending.filename}» для ${targetLabel}...`);

    try {
      console.log(`[UPLOAD] step=download user_id=${ctx.from.id} filename=${pending.filename}`);
      const buffer = await downloadFile(ctx, pending.file_id);
      console.log(
        `[UPLOAD] step=ingest user_id=${ctx.from.id} filename=${pending.filename} bytes=${buffer.length}`
      );
      const { chunks, safeName } = await ingestFile(buffer, pending.filename);
      console.log(
        `[UPLOAD] step=embed_prepare user_id=${ctx.from.id} filename=${safeName} chunks=${chunks.length} agents=${targetAgents.join(',')}`
      );

      // Re-upload safe flow: сначала embed+insert под временным именем,
      // потом DELETE старых чанков и RENAME tmp → финальное имя.
      // Если embed/insert упадёт - старые данные нетронуты.
      const tmpName = `${safeName}__tmp_${Date.now()}`;
      const embeddings = await embedChunks(chunks);
      console.log(
        `[UPLOAD] step=embed_done user_id=${ctx.from.id} filename=${safeName} embeddings=${embeddings.length}`
      );
      const rows = [];
      for (const agent of targetAgents) {
        for (let i = 0; i < chunks.length; i++) {
          rows.push({
            content: chunks[i],
            embedding: embeddings[i],
            agent_type: agent,
            filename: tmpName,
          });
        }
      }

      try {
        console.log(
          `[UPLOAD] step=insert_tmp user_id=${ctx.from.id} tmp=${tmpName} rows=${rows.length}`
        );
        await insertDocumentChunks(rows);
        console.log(
          `[UPLOAD] step=delete_old user_id=${ctx.from.id} filename=${safeName} agents=${targetAgents.join(',')}`
        );
        await deleteDocumentsByFilenameForAgents(safeName, targetAgents);
        console.log(
          `[UPLOAD] step=rename_tmp user_id=${ctx.from.id} from=${tmpName} to=${safeName}`
        );
        await renameDocuments(tmpName, safeName);
      } catch (commitErr) {
        logDetailedError('UPLOAD_COMMIT', commitErr, {
          userId: ctx.from.id,
          filename: safeName,
          tmpName,
          targetAgents,
        });
        await deleteDocumentsByFilename(tmpName).catch(() => {});
        throw commitErr;
      }

      await deletePendingUpload(ctx.from.id).catch(() => {});
      const countLabel = isAll
        ? `${chunks.length} чанков × ${targetAgents.length} агентов`
        : `${chunks.length} чанков для агента ${AGENT_NAMES[choice]}`;
      auditBestEffort('upload_completed', {
        severity: 'info',
        actorUserId: ctx.from.id,
        meta: {
          filename: safeName,
          chunks: chunks.length,
          targetAgents,
        },
      });
      console.log(
        `[UPLOAD] success user_id=${ctx.from.id} filename=${safeName} result=${countLabel}`
      );
      await ctx.reply(`Документ «${safeName}» загружен: ${countLabel}`);
    } catch (e) {
      await deletePendingUpload(ctx.from.id).catch(() => {});
      logDetailedError('UPLOAD', e, {
        userId: ctx.from.id,
        filename: pending?.filename,
        choice,
      });
      auditBestEffort('upload_failed', {
        severity: 'error',
        actorUserId: ctx.from.id,
        meta: {
          filename: pending?.filename || null,
          choice,
          message: e?.message || 'unknown',
          code: e?.code || null,
        },
      });
      const messages = {
        FILE_EMPTY: 'Файл пустой.',
        FILE_TOO_LARGE: 'Файл больше 10 МБ.',
        FILE_UNSUPPORTED_TYPE: 'Неподдерживаемый тип файла (допустимы PDF, DOCX, TXT).',
        FILE_NO_CONTENT: 'Не удалось извлечь текст из файла.',
        FILE_DOWNLOAD_FAILED: 'Не удалось скачать файл.',
        GEMINI_GLOBAL_LIMIT: 'Дневной лимит API исчерпан. Попробуйте позже.',
        GEMINI_TIMEOUT: 'Превышено время ожидания API.',
        GEMINI_RATE_LIMIT: 'Слишком много запросов, подождите минуту.',
        GEMINI_SERVER_ERROR: 'Сервис временно недоступен.',
      };
      const humanMessage = messages[e.message] || 'Ошибка при загрузке документа.';
      const debugMessage =
        `${humanMessage}\n\n` +
        `Технические детали:\n` +
        `${formatErrorDetails(e)}`;
      await ctx.reply(debugMessage);
    }
  });

  // /list_docs
  bot.command('list_docs', async (ctx) => {
    if (!isAdmin(ctx)) return;
    try {
      const docs = await listDocuments();
      if (docs.length === 0) {
        return ctx.reply('Документов нет');
      }
      const lines = docs.map(
        (d) => `• ${d.filename} - ${AGENT_NAMES[d.agent_type] || d.agent_type} (${d.chunks} чанков)`
      );
      await ctx.reply(`Документы (${docs.length}):\n\n${lines.join('\n')}`);
    } catch (e) {
      console.error(`[LIST_DOCS] user_id=${ctx.from.id} error`);
      await ctx.reply('Ошибка при получении списка документов');
    }
  });

  // /delete_doc <filename>
  bot.command('delete_doc', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const parts = ctx.message.text.split(/\s+/);
    if (parts.length < 2) {
      return ctx.reply('Использование: /delete_doc {filename}');
    }
    const filename = sanitizeFilename(parts.slice(1).join(' ').trim());
    try {
      await deleteDocumentsByFilename(filename);
      auditBestEffort('document_deleted', {
        severity: 'warning',
        actorUserId: ctx.from.id,
        meta: { filename },
      });
      await ctx.reply(`Документ «${filename}» удалён`);
    } catch (e) {
      console.error(`[DELETE_DOC] user_id=${ctx.from.id} error`);
      await ctx.reply('Ошибка при удалении документа');
    }
  });
}

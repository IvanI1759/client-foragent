export function getAdminIds() {
  const owner = (process.env.OWNER_CHAT_ID || '').trim();
  const admins = (process.env.ADMIN_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const legacyAdmins = (process.env.ADMIN_CHAT_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return [...new Set([owner, ...admins, ...legacyAdmins].filter(Boolean))];
}

export function isAdmin(ctx) {
  if (!ctx?.from?.id) return false;
  return getAdminIds().includes(String(ctx.from.id));
}

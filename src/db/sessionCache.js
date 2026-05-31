const cache = new Map();

const EMPTY_SESSION = Object.freeze({
  selected_agent: null,
  message_history: [],
});

export function getCachedSession(userId) {
  const entry = cache.get(String(userId));
  if (!entry) return null;
  return {
    selected_agent: entry.selected_agent ?? null,
    message_history: Array.isArray(entry.message_history) ? [...entry.message_history] : [],
  };
}

export function setCachedSession(userId, session) {
  cache.set(String(userId), {
    selected_agent: session?.selected_agent ?? null,
    message_history: Array.isArray(session?.message_history) ? [...session.message_history] : [],
  });
}

export function clearCachedHistory(userId) {
  const key = String(userId);
  const entry = cache.get(key);
  if (!entry) {
    cache.set(key, { ...EMPTY_SESSION });
    return;
  }
  entry.message_history = [];
}

export function emptySession() {
  return { selected_agent: null, message_history: [] };
}

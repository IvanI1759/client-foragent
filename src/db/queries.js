import { supabase } from './supabase.js';

// ---------- access_list ----------

export async function checkAccess(userId) {
  const { data, error } = await supabase
    .from('access_list')
    .select('active')
    .eq('user_id', userId)
    .eq('active', true)
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

export async function grantAccess(userId, grantedBy) {
  const { error } = await supabase
    .from('access_list')
    .upsert(
      {
        user_id: userId,
        granted_by: grantedBy,
        active: true,
        granted_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    );
  if (error) throw error;
}

export async function revokeAccess(userId) {
  const { data, error } = await supabase
    .from('access_list')
    .update({ active: false })
    .eq('user_id', userId)
    .eq('active', true)
    .select('user_id');
  if (error) throw error;
  return data && data.length > 0;
}

export async function listActiveUsers() {
  const { data, error } = await supabase
    .from('access_list')
    .select('user_id, granted_by, granted_at')
    .eq('active', true)
    .order('granted_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

// ---------- sessions ----------

export async function getSession(userId) {
  const { data, error } = await supabase
    .from('sessions')
    .select('user_id, selected_agent, message_history')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data || { user_id: userId, selected_agent: null, message_history: [] };
}

export async function saveSession(userId, { selected_agent, message_history }) {
  const { error } = await supabase
    .from('sessions')
    .upsert(
      {
        user_id: userId,
        selected_agent,
        message_history,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    );
  if (error) throw error;
}

export async function clearSessionHistory(userId) {
  const { error } = await supabase
    .from('sessions')
    .update({ message_history: [], updated_at: new Date().toISOString() })
    .eq('user_id', userId);
  if (error) throw error;
}

// ---------- user rate limit ----------

export async function checkAndIncrementUserRateLimit(userId) {
  const limit = parseInt(process.env.USER_RATE_LIMIT, 10) || 20;
  const now = new Date();
  const windowMs = 60 * 60 * 1000;

  const { data, error: readErr } = await supabase
    .from('rate_limits')
    .select('request_count, window_start')
    .eq('user_id', userId)
    .maybeSingle();
  if (readErr) throw readErr;

  const windowStart = data ? new Date(data.window_start) : null;
  const expired = !windowStart || now - windowStart > windowMs;
  const current = expired ? 0 : data.request_count;

  if (current >= limit) {
    const resetAt = new Date(windowStart.getTime() + windowMs);
    return { allowed: false, remaining: 0, resetAt };
  }

  const newCount = current + 1;
  const { error: upErr } = await supabase
    .from('rate_limits')
    .upsert(
      {
        user_id: userId,
        request_count: newCount,
        window_start: expired ? now.toISOString() : data.window_start,
      },
      { onConflict: 'user_id' }
    );
  if (upErr) throw upErr;

  return { allowed: true, remaining: limit - newCount };
}

// ---------- documents ----------

export async function deleteDocumentsByFilename(filename) {
  const { error } = await supabase.from('documents').delete().eq('filename', filename);
  if (error) throw error;
}

export async function insertDocumentChunks(rows) {
  if (!rows || rows.length === 0) return;
  const { error } = await supabase.from('documents').insert(rows);
  if (error) throw error;
}

export async function renameDocuments(fromFilename, toFilename) {
  const { error } = await supabase
    .from('documents')
    .update({ filename: toFilename })
    .eq('filename', fromFilename);
  if (error) throw error;
}

export async function matchDocuments(embedding, agentType, threshold = 0.7, count = 3) {
  const { data, error } = await supabase.rpc('match_documents', {
    query_embedding: embedding,
    match_threshold: threshold,
    match_count: count,
    filter_agent_type: agentType,
  });
  if (error) throw error;
  return data || [];
}

export async function listDocuments() {
  const { data, error } = await supabase
    .from('documents')
    .select('filename, agent_type')
    .order('filename');
  if (error) throw error;

  const grouped = new Map();
  for (const row of data || []) {
    const key = `${row.filename}::${row.agent_type}`;
    grouped.set(key, (grouped.get(key) || 0) + 1);
  }
  return Array.from(grouped.entries()).map(([key, chunks]) => {
    const [filename, agent_type] = key.split('::');
    return { filename, agent_type, chunks };
  });
}

export async function getDocumentStats() {
  const { data, error } = await supabase.from('documents').select('agent_type');
  if (error) throw error;

  const byAgent = {};
  for (const row of data || []) {
    byAgent[row.agent_type] = (byAgent[row.agent_type] || 0) + 1;
  }
  return { total: data?.length || 0, byAgent };
}

// ---------- global_api_counter ----------

export async function checkGlobalCounter() {
  const { data, error } = await supabase
    .from('global_api_counter')
    .select('daily_count, reset_date')
    .eq('id', 1)
    .single();
  if (error) throw error;

  const today = new Date().toISOString().split('T')[0];
  const limit = parseInt(process.env.DAILY_API_LIMIT, 10) || 250;

  if (data.reset_date !== today) {
    return { allowed: true, count: 0, limit, warning: false, reset: true };
  }
  const allowed = data.daily_count < limit;
  const warning = data.daily_count >= Math.floor(limit * 0.8);
  return { allowed, count: data.daily_count, limit, warning, reset: false };
}

export async function incrementGlobalCounter() {
  const { data, error } = await supabase.rpc('increment_api_counter');
  if (error) throw error;
  return data;
}

// ---------- stats ----------

export async function getStats() {
  const [users, docs, counter] = await Promise.all([
    supabase.from('access_list').select('user_id', { count: 'exact', head: true }).eq('active', true),
    getDocumentStats(),
    supabase.from('global_api_counter').select('daily_count, reset_date').eq('id', 1).single(),
  ]);

  return {
    activeUsers: users.count || 0,
    documents: docs,
    apiUsage: counter.data || { daily_count: 0, reset_date: null },
  };
}

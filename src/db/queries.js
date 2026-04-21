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

export async function checkAndIncrementUserRateLimit(userId, limitOverride = null) {
  const limit = limitOverride ?? (parseInt(process.env.USER_RATE_LIMIT, 10) || 20);
  const { data, error } = await supabase.rpc('check_and_increment_user_rate_limit', {
    p_user_id: userId,
    p_limit: limit,
    p_window_seconds: 60 * 60,
  });
  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : data;
  return {
    allowed: !!row?.allowed,
    remaining: row?.remaining ?? 0,
    resetAt: row?.reset_at ? new Date(row.reset_at) : null,
  };
}

// ---------- documents ----------

export async function deleteDocumentsByFilename(filename) {
  const { error } = await supabase.from('documents').delete().eq('filename', filename);
  if (error) throw error;
}

export async function deleteDocumentsByFilenameForAgents(filename, agents) {
  if (!agents || agents.length === 0) return;
  const { error } = await supabase
    .from('documents')
    .delete()
    .eq('filename', filename)
    .in('agent_type', agents);
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

export async function reserveGlobalApiCall() {
  const limit = parseInt(process.env.DAILY_API_LIMIT, 10) || 250;
  const { data, error } = await supabase.rpc('reserve_global_api_call', {
    p_limit: limit,
  });
  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : data;
  return {
    allowed: !!row?.allowed,
    count: row?.count ?? 0,
    resetDate: row?.reset_date ?? null,
    limit,
    warning: (row?.count ?? 0) >= Math.floor(limit * 0.8),
  };
}

// ---------- pending_uploads ----------

export async function savePendingUpload(userId, fileId, filename) {
  const { error } = await supabase
    .from('pending_uploads')
    .upsert(
      {
        admin_user_id: userId,
        file_id: fileId,
        filename,
        created_at: new Date().toISOString(),
      },
      { onConflict: 'admin_user_id' }
    );
  if (error) throw error;
}

export async function getPendingUpload(userId) {
  const { data, error } = await supabase
    .from('pending_uploads')
    .select('admin_user_id, file_id, filename, created_at')
    .eq('admin_user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

export async function deletePendingUpload(userId) {
  const { error } = await supabase
    .from('pending_uploads')
    .delete()
    .eq('admin_user_id', userId);
  if (error) throw error;
}

// ---------- audit_logs ----------

export async function recordAuditEvent(eventType, {
  severity = 'info',
  actorUserId = null,
  targetUserId = null,
  meta = {},
} = {}) {
  const { error } = await supabase
    .from('audit_logs')
    .insert({
      event_type: eventType,
      severity,
      actor_user_id: actorUserId,
      target_user_id: targetUserId,
      meta,
    });
  if (error) throw error;
}

export async function hasAssistantResponse(userId) {
  const { data, error } = await supabase
    .from('audit_logs')
    .select('id')
    .eq('event_type', 'assistant_response_sent')
    .eq('actor_user_id', userId)
    .limit(1);
  if (error) throw error;
  return Array.isArray(data) && data.length > 0;
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

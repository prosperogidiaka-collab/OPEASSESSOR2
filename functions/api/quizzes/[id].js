import {
  apiErrorResponse,
  jsonResponse,
  preflightResponse,
  readEnv,
  readJsonBody
} from '../_lib/shared.js';
import { getSessionFromRequest } from '../_lib/auth.js';
import { buildQuizRow } from '../../../state-store.js';

const ALLOW = 'PUT, POST, OPTIONS';

let cachedClient = null;

async function getSupabaseClient(env) {
  if (cachedClient) return cachedClient;
  const supabaseUrl = readEnv(env, 'SUPABASE_URL').trim();
  const supabaseServiceRoleKey = readEnv(env, 'SUPABASE_SERVICE_ROLE_KEY').trim();
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    const error = new Error('Per-quiz sync requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
    error.statusCode = 503;
    throw error;
  }
  const { createClient } = await import('@supabase/supabase-js');
  cachedClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
  return cachedClient;
}

export async function onRequest(context) {
  const { request, env, params } = context;
  const preflight = preflightResponse(request, env, { allowMethods: ALLOW });
  if (preflight) return preflight;

  // Accept POST as well as PUT — PUT is canonical (idempotent upsert keyed by
  // quiz id), but a stray POST from an older client build is harmless and
  // shouldn't 405.
  if (request.method !== 'PUT' && request.method !== 'POST') {
    return jsonResponse(request, env, 405, { error: 'Method not allowed' }, {}, { allowMethods: ALLOW });
  }

  const session = getSessionFromRequest(env, request);
  if (!session) {
    return jsonResponse(request, env, 401, { error: 'Authentication required' }, {}, { allowMethods: ALLOW });
  }

  const rawId = Array.isArray(params.id) ? params.id[0] : params.id;
  const id = decodeURIComponent((rawId || '').toString()).trim();
  if (!id) {
    return jsonResponse(request, env, 400, { error: 'Missing quiz id' }, {}, { allowMethods: ALLOW });
  }

  let parsed;
  try {
    parsed = await readJsonBody(request);
  } catch (error) {
    return jsonResponse(request, env, 400, { error: 'Invalid JSON body' }, {}, { allowMethods: ALLOW });
  }

  const quiz = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  if (!quiz) {
    return jsonResponse(request, env, 400, { error: 'Quiz body must be an object' }, {}, { allowMethods: ALLOW });
  }

  const bodyTeacherId = (quiz.teacherId || '').toString().trim().toLowerCase();
  const sessionEmail = (session.email || '').toString().trim().toLowerCase();
  const isAdmin = session.role === 'super_admin';
  if (!isAdmin && bodyTeacherId && bodyTeacherId !== sessionEmail) {
    return jsonResponse(request, env, 403, { error: 'Cannot save a quiz owned by another teacher' }, {}, { allowMethods: ALLOW });
  }
  if (!isAdmin && !bodyTeacherId) {
    quiz.teacherId = sessionEmail;
  }

  try {
    const supabase = await getSupabaseClient(env);
    const tablePrefix = readEnv(env, 'SUPABASE_TABLE_PREFIX', 'ope_').trim();
    const quizzesTable = `${tablePrefix}quizzes`;

    const { data: existing, error: lookupError } = await supabase
      .from(quizzesTable)
      .select('teacher_id')
      .eq('quiz_id', id)
      .maybeSingle();
    if (lookupError) {
      const wrapped = new Error(`Supabase lookup failed for ${quizzesTable}: ${lookupError.message}`);
      wrapped.cause = lookupError;
      throw wrapped;
    }
    if (existing && existing.teacher_id && existing.teacher_id !== sessionEmail && !isAdmin) {
      return jsonResponse(request, env, 403, { error: 'Quiz id is already owned by another teacher' }, {}, { allowMethods: ALLOW });
    }

    const syncedAt = new Date().toISOString();
    const row = { ...buildQuizRow(id, quiz), synced_at: syncedAt };

    const { error: upsertError } = await supabase
      .from(quizzesTable)
      .upsert([row], { onConflict: 'quiz_id' });
    if (upsertError) {
      const wrapped = new Error(`Supabase upsert failed for ${quizzesTable}: ${upsertError.message}`);
      wrapped.cause = upsertError;
      throw wrapped;
    }

    return jsonResponse(request, env, 200, { ok: true, id, syncedAt }, {}, { allowMethods: ALLOW });
  } catch (error) {
    return apiErrorResponse(request, env, error, 'Failed to save quiz', { allowMethods: ALLOW });
  }
}

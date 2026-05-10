import {
  apiErrorResponse,
  jsonResponse,
  preflightResponse,
  readEnv,
  readJsonBody
} from '../_lib/shared.js';
import { getSessionFromRequest } from '../_lib/auth.js';
import { buildQuizRow } from '../../../state-store.js';

const ALLOW = 'GET, PUT, POST, OPTIONS';

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
  // shouldn't 405. GET is the per-quiz pull; it's the cheap alternative to
  // GET /api/state when the client only needs to refresh one quiz.
  if (request.method !== 'GET' && request.method !== 'PUT' && request.method !== 'POST') {
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

  const sessionEmail = (session.email || '').toString().trim().toLowerCase();
  const isAdmin = session.role === 'super_admin';

  if (request.method === 'GET') {
    try {
      const supabase = await getSupabaseClient(env);
      const tablePrefix = readEnv(env, 'SUPABASE_TABLE_PREFIX', 'ope_').trim();
      const quizzesTable = `${tablePrefix}quizzes`;
      const submissionsTable = `${tablePrefix}submissions`;

      // Per-quiz read. Filter by quiz_id + teacher_id so a teacher can never
      // even probe for a quiz that isn't theirs (404 leaks no information about
      // foreign rows). Super-admin skips the teacher_id filter.
      let quizQuery = supabase
        .from(quizzesTable)
        .select('quiz_id, teacher_id, title, created_at, updated_at, payload')
        .eq('quiz_id', id);
      if (!isAdmin) quizQuery = quizQuery.eq('teacher_id', sessionEmail);
      const { data: quizRow, error: quizError } = await quizQuery.maybeSingle();
      if (quizError) {
        const wrapped = new Error(`Supabase lookup failed for ${quizzesTable}: ${quizError.message}`);
        wrapped.cause = quizError;
        throw wrapped;
      }
      if (!quizRow) {
        return jsonResponse(request, env, 404, { error: 'Quiz not found' }, {}, { allowMethods: ALLOW });
      }

      // Submissions table has no teacher_id column; ownership is verified via
      // the parent quiz lookup above, so quiz_id is sufficient here.
      const { data: submissionRows, error: submissionsError } = await supabase
        .from(submissionsTable)
        .select('submission_id, quiz_id, student_email, submitted_at, updated_at, payload')
        .eq('quiz_id', id)
        .order('submitted_at', { ascending: true });
      if (submissionsError) {
        const wrapped = new Error(`Supabase lookup failed for ${submissionsTable}: ${submissionsError.message}`);
        wrapped.cause = submissionsError;
        throw wrapped;
      }

      const quiz = (quizRow && typeof quizRow.payload === 'object' && quizRow.payload) ? { ...quizRow.payload } : {};
      if (!quiz.id) quiz.id = quizRow.quiz_id;
      if (!quiz.teacherId && quizRow.teacher_id) quiz.teacherId = quizRow.teacher_id;
      if (!quiz.title && quizRow.title) quiz.title = quizRow.title;
      if (!quiz.createdAt && quizRow.created_at) quiz.createdAt = quizRow.created_at;
      if (!quiz.updatedAt && quizRow.updated_at) quiz.updatedAt = quizRow.updated_at;

      const submissions = (submissionRows || []).map((row) => {
        const payload = (row && typeof row.payload === 'object' && row.payload) ? { ...row.payload } : {};
        if (!payload.submissionId && row.submission_id) payload.submissionId = row.submission_id;
        if (!payload.quizId && row.quiz_id) payload.quizId = row.quiz_id;
        if (!payload.email && row.student_email) payload.email = row.student_email;
        if (!payload.submittedAt && row.submitted_at) payload.submittedAt = row.submitted_at;
        if (!payload.updatedAt && row.updated_at) payload.updatedAt = row.updated_at;
        return payload;
      });

      return jsonResponse(request, env, 200, { quiz, submissions }, {}, { allowMethods: ALLOW });
    } catch (error) {
      return apiErrorResponse(request, env, error, 'Failed to load quiz', { allowMethods: ALLOW });
    }
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

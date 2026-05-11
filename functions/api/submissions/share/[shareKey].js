import {
  apiErrorResponse,
  jsonResponse,
  preflightResponse,
  readEnv
} from '../../_lib/shared.js';

// Public, share-key-gated lookup. The shareKey is the access token: it's a
// per-submission random string the teacher embedded in the correction link
// they sent the student. No session is required — students opening the link
// from WhatsApp / email don't have one.
//
// Returns { submission, quiz } for the matching share key, or 404. The quiz
// object is the full payload; the submission is the answer record.

const ALLOW = 'GET, OPTIONS';

let cachedClient = null;

async function getSupabaseClient(env) {
  if (cachedClient) return cachedClient;
  const supabaseUrl = readEnv(env, 'SUPABASE_URL').trim();
  const supabaseServiceRoleKey = readEnv(env, 'SUPABASE_SERVICE_ROLE_KEY').trim();
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    const error = new Error('Share lookup requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
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
  if (request.method !== 'GET') {
    return jsonResponse(request, env, 405, { error: 'Method not allowed' }, {}, { allowMethods: ALLOW });
  }

  const rawKey = Array.isArray(params.shareKey) ? params.shareKey[0] : params.shareKey;
  const shareKey = decodeURIComponent((rawKey || '').toString()).trim().toLowerCase();
  if (!shareKey) {
    return jsonResponse(request, env, 400, { error: 'Missing share key' }, {}, { allowMethods: ALLOW });
  }

  try {
    const supabase = await getSupabaseClient(env);
    const tablePrefix = readEnv(env, 'SUPABASE_TABLE_PREFIX', 'ope_').trim();
    const submissionsTable = `${tablePrefix}submissions`;
    const quizzesTable = `${tablePrefix}quizzes`;

    // shareKey lives inside the JSON payload, not as a top-level column. Use
    // a JSON-path filter so this is an indexed lookup hit (Postgres can
    // build a GIN index on payload if egress climbs) instead of a full scan.
    const { data: submissionRows, error: submissionsError } = await supabase
      .from(submissionsTable)
      .select('submission_id, quiz_id, student_email, submitted_at, updated_at, payload')
      .filter('payload->>shareKey', 'eq', shareKey)
      .limit(1);
    if (submissionsError) {
      const wrapped = new Error(`Supabase lookup failed for ${submissionsTable}: ${submissionsError.message}`);
      wrapped.cause = submissionsError;
      throw wrapped;
    }
    const submissionRow = (submissionRows && submissionRows[0]) || null;
    if (!submissionRow) {
      return jsonResponse(request, env, 404, { error: 'Correction not found for this share link.' }, {}, { allowMethods: ALLOW });
    }

    const submission = (submissionRow.payload && typeof submissionRow.payload === 'object') ? { ...submissionRow.payload } : {};
    if (!submission.submissionId && submissionRow.submission_id) submission.submissionId = submissionRow.submission_id;
    if (!submission.quizId && submissionRow.quiz_id) submission.quizId = submissionRow.quiz_id;
    if (!submission.email && submissionRow.student_email) submission.email = submissionRow.student_email;
    if (!submission.submittedAt && submissionRow.submitted_at) submission.submittedAt = submissionRow.submitted_at;
    if (!submission.updatedAt && submissionRow.updated_at) submission.updatedAt = submissionRow.updated_at;
    if (!submission.shareKey) submission.shareKey = shareKey;

    let quiz = null;
    const quizId = submissionRow.quiz_id || submission.quizId;
    if (quizId) {
      const { data: quizRow, error: quizError } = await supabase
        .from(quizzesTable)
        .select('quiz_id, teacher_id, title, created_at, updated_at, payload')
        .eq('quiz_id', quizId)
        .maybeSingle();
      if (quizError) {
        const wrapped = new Error(`Supabase lookup failed for ${quizzesTable}: ${quizError.message}`);
        wrapped.cause = quizError;
        throw wrapped;
      }
      if (quizRow) {
        quiz = (quizRow.payload && typeof quizRow.payload === 'object') ? { ...quizRow.payload } : {};
        if (!quiz.id) quiz.id = quizRow.quiz_id;
        if (!quiz.teacherId && quizRow.teacher_id) quiz.teacherId = quizRow.teacher_id;
        if (!quiz.title && quizRow.title) quiz.title = quizRow.title;
        if (!quiz.createdAt && quizRow.created_at) quiz.createdAt = quizRow.created_at;
        if (!quiz.updatedAt && quizRow.updated_at) quiz.updatedAt = quizRow.updated_at;
      }
    }

    return jsonResponse(request, env, 200, { submission, quiz }, {}, { allowMethods: ALLOW });
  } catch (error) {
    return apiErrorResponse(request, env, error, 'Failed to load correction', { allowMethods: ALLOW });
  }
}

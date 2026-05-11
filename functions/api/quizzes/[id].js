import {
  apiErrorResponse,
  jsonResponse,
  preflightResponse,
  readEnv,
  readJsonBody
} from '../_lib/shared.js';
import { getSessionFromRequest } from '../_lib/auth.js';
import { buildQuizRow } from '../../../state-store.js';

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeKey(value, fallback = '') {
  return ((value == null ? '' : value) || fallback || '').toString().trim();
}

function normalizeLowerKey(value, fallback = '') {
  return normalizeKey(value, fallback).toLowerCase();
}

function toIsoOrNull(value) {
  if (!value) return null;
  const stamp = new Date(value);
  return Number.isNaN(stamp.getTime()) ? null : stamp.toISOString();
}

function buildSubmissionRowForQuiz(item, quizId, index = 0) {
  // Mirror buildSubmissionRows() in state-store.js so the rows we upsert
  // through the per-quiz endpoint look identical to the bulk path.
  const baseSubmissionId = (item && item.submissionId)
    ? normalizeKey(item.submissionId, `submission-${index}`)
    : `${quizId}::${normalizeLowerKey(item && item.email)}::${(item && (item.submittedAt || item.updatedAt || item.startedAt || item.createdAt)) || `idx-${index}`}`;
  return {
    submission_id: baseSubmissionId,
    quiz_id: quizId,
    student_email: normalizeLowerKey(item && item.email),
    submitted_at: toIsoOrNull(item && item.submittedAt),
    updated_at: toIsoOrNull(item && (item.updatedAt || item.submittedAt || item.startedAt || item.createdAt)),
    payload: { ...(item || {}), submissionId: baseSubmissionId, quizId }
  };
}

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

  const rawId = Array.isArray(params.id) ? params.id[0] : params.id;
  const id = decodeURIComponent((rawId || '').toString()).trim();
  if (!id) {
    return jsonResponse(request, env, 400, { error: 'Missing quiz id' }, {}, { allowMethods: ALLOW });
  }

  const sessionEmail = session ? (session.email || '').toString().trim().toLowerCase() : '';
  const isAdmin = !!session && session.role === 'super_admin';

  if (request.method === 'GET') {
    // Public, code-gated read. A student opening a quiz by its 6-digit code /
    // ?q=<id> link has no session, so GET must work unauthenticated — the code
    // itself is the access token (same model as the public share-key correction
    // endpoint, which already returns full quiz payloads). Anonymous callers and
    // teachers who don't own the quiz get the quiz only — never the submissions
    // list (PII). The owner / super-admin also gets that quiz's submissions.
    try {
      const supabase = await getSupabaseClient(env);
      const tablePrefix = readEnv(env, 'SUPABASE_TABLE_PREFIX', 'ope_').trim();
      const quizzesTable = `${tablePrefix}quizzes`;
      const submissionsTable = `${tablePrefix}submissions`;

      const { data: quizRow, error: quizError } = await supabase
        .from(quizzesTable)
        .select('quiz_id, teacher_id, title, created_at, updated_at, payload')
        .eq('quiz_id', id)
        .maybeSingle();
      if (quizError) {
        const wrapped = new Error(`Supabase lookup failed for ${quizzesTable}: ${quizError.message}`);
        wrapped.cause = quizError;
        throw wrapped;
      }
      if (!quizRow) {
        return jsonResponse(request, env, 404, { error: 'Quiz not found' }, {}, { allowMethods: ALLOW });
      }

      const quiz = (quizRow && typeof quizRow.payload === 'object' && quizRow.payload) ? { ...quizRow.payload } : {};
      if (!quiz.id) quiz.id = quizRow.quiz_id;
      if (!quiz.teacherId && quizRow.teacher_id) quiz.teacherId = quizRow.teacher_id;
      if (!quiz.title && quizRow.title) quiz.title = quizRow.title;
      if (!quiz.createdAt && quizRow.created_at) quiz.createdAt = quizRow.created_at;
      if (!quiz.updatedAt && quizRow.updated_at) quiz.updatedAt = quizRow.updated_at;

      const ownsQuiz = isAdmin || (!!sessionEmail && (quizRow.teacher_id || '').toString().trim().toLowerCase() === sessionEmail);
      if (!ownsQuiz) {
        return jsonResponse(request, env, 200, { quiz }, {}, { allowMethods: ALLOW });
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

  // Writes (PUT / POST) still require a teacher / admin session.
  if (!session) {
    return jsonResponse(request, env, 401, { error: 'Authentication required' }, {}, { allowMethods: ALLOW });
  }

  let parsed;
  try {
    parsed = await readJsonBody(request);
  } catch (error) {
    return jsonResponse(request, env, 400, { error: 'Invalid JSON body' }, {}, { allowMethods: ALLOW });
  }

  if (!isPlainObject(parsed)) {
    return jsonResponse(request, env, 400, { error: 'Body must be a JSON object' }, {}, { allowMethods: ALLOW });
  }

  // Two accepted body shapes:
  //   1) <quiz>                       — legacy bare-quiz upsert (per-quiz save).
  //   2) { quiz?, submissions? }      — bundle: optionally upsert the quiz AND
  //                                      any submissions for it. Used by the
  //                                      teacher-side regrade / delete flows so
  //                                      they don't have to fall back to bulk
  //                                      PUT /api/state/submissions.
  const isBundle = Array.isArray(parsed.submissions) || (isPlainObject(parsed.quiz) && parsed.submissions !== undefined);
  const quiz = isBundle
    ? (isPlainObject(parsed.quiz) ? parsed.quiz : null)
    : parsed;
  const submissionsInput = isBundle && Array.isArray(parsed.submissions) ? parsed.submissions : null;

  if (!quiz && !submissionsInput) {
    return jsonResponse(request, env, 400, { error: 'Body must include quiz, submissions, or both' }, {}, { allowMethods: ALLOW });
  }

  if (quiz) {
    const bodyTeacherId = (quiz.teacherId || '').toString().trim().toLowerCase();
    if (!isAdmin && bodyTeacherId && bodyTeacherId !== sessionEmail) {
      return jsonResponse(request, env, 403, { error: 'Cannot save a quiz owned by another teacher' }, {}, { allowMethods: ALLOW });
    }
    // Always stamp the session as owner when the body doesn't carry one (incl.
    // for super-admin pushes). Without this, a quiz with no teacherId lands in
    // Supabase with an empty teacher_id column — and the bulk submissions read
    // filters by owned quiz_ids, so the teacher would never see its results.
    // An admin who wants to assign the quiz to a specific teacher can still do
    // that by including teacherId in the request body.
    if (!bodyTeacherId && sessionEmail) {
      quiz.teacherId = sessionEmail;
    }
  }

  try {
    const supabase = await getSupabaseClient(env);
    const tablePrefix = readEnv(env, 'SUPABASE_TABLE_PREFIX', 'ope_').trim();
    const quizzesTable = `${tablePrefix}quizzes`;
    const submissionsTable = `${tablePrefix}submissions`;

    // Ownership check is done against the existing quiz row regardless of
    // which body shape was sent — a teacher must own (or be admin for) the
    // quiz before we accept a submissions upsert against its quiz_id.
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
    if (submissionsInput && !existing && !quiz) {
      return jsonResponse(request, env, 404, { error: 'Quiz must exist before its submissions can be saved' }, {}, { allowMethods: ALLOW });
    }

    const syncedAt = new Date().toISOString();
    let submissionsUpserted = 0;

    if (quiz) {
      const row = { ...buildQuizRow(id, quiz), synced_at: syncedAt };
      const { error: upsertError } = await supabase
        .from(quizzesTable)
        .upsert([row], { onConflict: 'quiz_id' });
      if (upsertError) {
        const wrapped = new Error(`Supabase upsert failed for ${quizzesTable}: ${upsertError.message}`);
        wrapped.cause = upsertError;
        throw wrapped;
      }
    }

    if (submissionsInput) {
      // Validate every submission belongs to THIS quiz before we touch the
      // database. Skip blank/non-object entries silently. A mismatched quizId
      // is a hard 400 — refuse to write rows for a quiz the caller didn't
      // address in the URL.
      const submissionRows = [];
      for (let index = 0; index < submissionsInput.length; index += 1) {
        const item = submissionsInput[index];
        if (!isPlainObject(item)) continue;
        const itemQuizId = (item.quizId || '').toString().trim();
        if (itemQuizId && itemQuizId !== id) {
          return jsonResponse(request, env, 400, { error: `submissions[${index}].quizId does not match the quiz in the URL` }, {}, { allowMethods: ALLOW });
        }
        submissionRows.push(buildSubmissionRowForQuiz({ ...item, quizId: id }, id, index));
      }
      if (submissionRows.length) {
        // Upsert in batches to stay well under the 4 MB body cap. 100 rows
        // per batch keeps each request under typical limits even when
        // submissions embed images in payload.
        const BATCH = 100;
        for (let from = 0; from < submissionRows.length; from += BATCH) {
          const slice = submissionRows.slice(from, from + BATCH);
          const { error: subUpsertError } = await supabase
            .from(submissionsTable)
            .upsert(slice, { onConflict: 'submission_id' });
          if (subUpsertError) {
            const wrapped = new Error(`Supabase upsert failed for ${submissionsTable}: ${subUpsertError.message}`);
            wrapped.cause = subUpsertError;
            throw wrapped;
          }
        }
        submissionsUpserted = submissionRows.length;
      }
    }

    return jsonResponse(request, env, 200, { ok: true, id, syncedAt, submissionsUpserted }, {}, { allowMethods: ALLOW });
  } catch (error) {
    return apiErrorResponse(request, env, error, 'Failed to save quiz', { allowMethods: ALLOW });
  }
}

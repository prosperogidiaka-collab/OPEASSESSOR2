import {
  apiErrorResponse,
  getStateStore,
  jsonResponse,
  preflightResponse,
  readJsonBody
} from '../../_lib/shared.js';
import {
  createSessionToken,
  getAuthConfig,
  hashPassword,
  verifyPasswordHash
} from '../../_lib/auth.js';

const ALLOW = 'POST, OPTIONS';

export async function onRequest(context) {
  const { request, env } = context;
  const preflight = preflightResponse(request, env, { allowMethods: ALLOW });
  if (preflight) return preflight;
  if (request.method !== 'POST') {
    return jsonResponse(request, env, 405, { error: 'Method not allowed' }, {}, { allowMethods: ALLOW });
  }
  let parsed;
  try {
    parsed = await readJsonBody(request);
  } catch (error) {
    return jsonResponse(request, env, 400, { error: 'Invalid JSON body' }, {}, { allowMethods: ALLOW });
  }
  const config = getAuthConfig(env);
  const email = (parsed.email || '').toString().trim().toLowerCase();
  const password = (parsed.password || '').toString();
  if (!email || !password) {
    return jsonResponse(request, env, 400, { error: 'Email and password are required' }, {}, { allowMethods: ALLOW });
  }
  if (email === config.superAdminEmail) {
    return jsonResponse(request, env, 401, { error: 'Use the admin login for this account' }, {}, { allowMethods: ALLOW });
  }
  try {
    const stateStore = getStateStore(env);
    const teachers = (await stateStore.getStateValue('teachers')) || {};
    const record = teachers && teachers[email];
    if (!record || typeof record !== 'object') {
      return jsonResponse(request, env, 401, { error: 'Invalid teacher ID or password' }, {}, { allowMethods: ALLOW });
    }
    let ok = false;
    let migratedRecord = null;
    if (record.passwordHash) {
      ok = verifyPasswordHash(password, record.passwordHash);
    } else if (typeof record.password === 'string' && record.password) {
      // Lazy-migrate plaintext → PBKDF2 on first successful login.
      if (record.password === password) {
        ok = true;
        migratedRecord = { ...record, passwordHash: hashPassword(env, password), passwordResetAt: new Date().toISOString() };
        delete migratedRecord.password;
      }
    }
    if (!ok) {
      return jsonResponse(request, env, 401, { error: 'Invalid teacher ID or password' }, {}, { allowMethods: ALLOW });
    }
    if (migratedRecord) {
      try {
        await stateStore.putStateValue('teachers', { [email]: migratedRecord });
      } catch (error) {
        // Migration is best-effort; login still succeeds.
      }
    }
    const token = createSessionToken(env, email, 'teacher');
    return jsonResponse(request, env, 200, {
      ok: true,
      sessionToken: token,
      role: 'teacher',
      email,
      expiresInMs: config.sessionTtlMs
    }, {}, { allowMethods: ALLOW });
  } catch (error) {
    return apiErrorResponse(request, env, error, 'Failed to verify teacher login', { allowMethods: ALLOW });
  }
}

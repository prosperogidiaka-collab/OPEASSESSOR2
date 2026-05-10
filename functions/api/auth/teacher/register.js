import {
  apiErrorResponse,
  buildAdminScope,
  getStateStore,
  jsonResponse,
  preflightResponse,
  readJsonBody
} from '../../_lib/shared.js';
import {
  createSessionToken,
  getAuthConfig,
  hashPassword
} from '../../_lib/auth.js';

const ALLOW = 'POST, OPTIONS';

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

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
  const profile = isPlainObject(parsed.profile) ? parsed.profile : {};
  if (!email || !password) {
    return jsonResponse(request, env, 400, { error: 'Email and password are required' }, {}, { allowMethods: ALLOW });
  }
  if (password.length < 4) {
    return jsonResponse(request, env, 400, { error: 'Password must be at least 4 characters' }, {}, { allowMethods: ALLOW });
  }
  if (email === config.superAdminEmail) {
    return jsonResponse(request, env, 409, { error: 'Admin account already exists. Login instead.' }, {}, { allowMethods: ALLOW });
  }
  try {
    const stateStore = getStateStore(env);
    // Pre-session existence check: must see the full teachers map to detect duplicates.
    const teachers = (await stateStore.getStateValue('teachers', buildAdminScope())) || {};
    if (teachers[email]) {
      return jsonResponse(request, env, 409, { error: 'Teacher ID already exists. Login instead.' }, {}, { allowMethods: ALLOW });
    }
    const now = new Date().toISOString();
    const cleanProfile = { ...profile };
    delete cleanProfile.password;
    delete cleanProfile.passwordHash;
    const newRecord = {
      ...cleanProfile,
      teacherId: email,
      email,
      passwordHash: hashPassword(env, password),
      role: 'teacher',
      name: cleanProfile.name || '',
      phone: cleanProfile.phone || '',
      tokenBalance: cleanProfile.tokenBalance ?? 0,
      tokenUpdatedAt: now,
      tokenRequestStatus: cleanProfile.tokenRequestStatus || '',
      unlimitedExpiresAt: cleanProfile.unlimitedExpiresAt || '',
      unlimitedDeviceId: cleanProfile.unlimitedDeviceId || '',
      createdAt: now,
      updatedAt: now,
      passwordResetAt: now
    };
    await stateStore.putStateValue('teachers', { [email]: newRecord });
    const token = createSessionToken(env, email, 'teacher');
    return jsonResponse(request, env, 200, {
      ok: true,
      sessionToken: token,
      role: 'teacher',
      email,
      expiresInMs: config.sessionTtlMs
    }, {}, { allowMethods: ALLOW });
  } catch (error) {
    return apiErrorResponse(request, env, error, 'Failed to create teacher account', { allowMethods: ALLOW });
  }
}

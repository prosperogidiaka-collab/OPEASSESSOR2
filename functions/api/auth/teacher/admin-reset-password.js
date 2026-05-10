import {
  apiErrorResponse,
  deriveScope,
  getStateStore,
  jsonResponse,
  preflightResponse,
  readJsonBody
} from '../../_lib/shared.js';
import {
  getAuthConfig,
  getSessionFromRequest,
  hashPassword
} from '../../_lib/auth.js';

const ALLOW = 'POST, OPTIONS';

export async function onRequest(context) {
  const { request, env } = context;
  const preflight = preflightResponse(request, env, { allowMethods: ALLOW });
  if (preflight) return preflight;
  if (request.method !== 'POST') {
    return jsonResponse(request, env, 405, { error: 'Method not allowed' }, {}, { allowMethods: ALLOW });
  }
  const session = getSessionFromRequest(env, request);
  if (!session || session.role !== 'super_admin') {
    return jsonResponse(request, env, 403, { error: 'Admin authentication required' }, {}, { allowMethods: ALLOW });
  }
  let parsed;
  try {
    parsed = await readJsonBody(request);
  } catch (error) {
    return jsonResponse(request, env, 400, { error: 'Invalid JSON body' }, {}, { allowMethods: ALLOW });
  }
  const config = getAuthConfig(env);
  const teacherEmail = (parsed.teacherEmail || '').toString().trim().toLowerCase();
  const newPassword = (parsed.newPassword || '').toString();
  if (!teacherEmail || !newPassword) {
    return jsonResponse(request, env, 400, { error: 'Teacher email and new password required' }, {}, { allowMethods: ALLOW });
  }
  if (newPassword.length < 4) {
    return jsonResponse(request, env, 400, { error: 'Password must be at least 4 characters' }, {}, { allowMethods: ALLOW });
  }
  if (teacherEmail === config.superAdminEmail) {
    return jsonResponse(request, env, 400, { error: 'Admin password is set via environment variables, not the API' }, {}, { allowMethods: ALLOW });
  }
  try {
    const stateStore = getStateStore(env);
    // Super-admin only — deriveScope returns admin scope so the cross-tenant lookup works.
    const teachers = (await stateStore.getStateValue('teachers', deriveScope(session))) || {};
    const record = teachers[teacherEmail];
    if (!record) {
      return jsonResponse(request, env, 404, { error: 'Teacher not found' }, {}, { allowMethods: ALLOW });
    }
    const now = new Date().toISOString();
    const updated = { ...record, passwordHash: hashPassword(env, newPassword), updatedAt: now, passwordResetAt: now };
    delete updated.password;
    await stateStore.putStateValue('teachers', { [teacherEmail]: updated });
    return jsonResponse(request, env, 200, { ok: true }, {}, { allowMethods: ALLOW });
  } catch (error) {
    return apiErrorResponse(request, env, error, 'Failed to reset teacher password', { allowMethods: ALLOW });
  }
}

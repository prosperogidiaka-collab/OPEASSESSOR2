import {
  apiErrorResponse,
  deriveScope,
  getStateStore,
  jsonResponse,
  preflightResponse,
  readJsonBody
} from '../../_lib/shared.js';
import {
  getSessionFromRequest,
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
  const session = getSessionFromRequest(env, request);
  if (!session) {
    return jsonResponse(request, env, 401, { error: 'Not authenticated' }, {}, { allowMethods: ALLOW });
  }
  if (session.role !== 'teacher') {
    return jsonResponse(request, env, 403, { error: 'Only teacher accounts can change their own password here' }, {}, { allowMethods: ALLOW });
  }
  let parsed;
  try {
    parsed = await readJsonBody(request);
  } catch (error) {
    return jsonResponse(request, env, 400, { error: 'Invalid JSON body' }, {}, { allowMethods: ALLOW });
  }
  const currentPassword = (parsed.currentPassword || '').toString();
  const newPassword = (parsed.newPassword || '').toString();
  if (!newPassword || newPassword.length < 4) {
    return jsonResponse(request, env, 400, { error: 'New password must be at least 4 characters' }, {}, { allowMethods: ALLOW });
  }
  try {
    const stateStore = getStateStore(env);
    const teachers = (await stateStore.getStateValue('teachers', deriveScope(session))) || {};
    const record = teachers[session.email];
    if (!record) {
      return jsonResponse(request, env, 404, { error: 'Teacher not found' }, {}, { allowMethods: ALLOW });
    }
    let currentOk = false;
    if (record.passwordHash) currentOk = verifyPasswordHash(currentPassword, record.passwordHash);
    else if (typeof record.password === 'string') currentOk = record.password === currentPassword;
    if (!currentOk) {
      return jsonResponse(request, env, 401, { error: 'Current password is incorrect' }, {}, { allowMethods: ALLOW });
    }
    const now = new Date().toISOString();
    const updated = { ...record, passwordHash: hashPassword(env, newPassword), updatedAt: now, passwordResetAt: now };
    delete updated.password;
    await stateStore.putStateValue('teachers', { [session.email]: updated });
    return jsonResponse(request, env, 200, { ok: true }, {}, { allowMethods: ALLOW });
  } catch (error) {
    return apiErrorResponse(request, env, error, 'Failed to change password', { allowMethods: ALLOW });
  }
}

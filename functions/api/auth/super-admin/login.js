import {
  jsonResponse,
  preflightResponse,
  readJsonBody
} from '../../_lib/shared.js';
import {
  createSessionToken,
  getAuthConfig,
  isSuperAdminConfigured
} from '../../_lib/auth.js';

const ALLOW = 'POST, OPTIONS';

export async function onRequest(context) {
  const { request, env } = context;
  const preflight = preflightResponse(request, env, { allowMethods: ALLOW });
  if (preflight) return preflight;
  if (request.method !== 'POST') {
    return jsonResponse(request, env, 405, { error: 'Method not allowed' }, {}, { allowMethods: ALLOW });
  }
  if (!isSuperAdminConfigured(env)) {
    return jsonResponse(request, env, 503, { error: 'Super-admin login is not configured on this deployment. Set SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD, and SESSION_SECRET in the hosting environment.' }, {}, { allowMethods: ALLOW });
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
  if (email !== config.superAdminEmail || password !== config.superAdminPassword) {
    return jsonResponse(request, env, 401, { error: 'Invalid admin email or password' }, {}, { allowMethods: ALLOW });
  }
  const token = createSessionToken(env, config.superAdminEmail, 'super_admin');
  return jsonResponse(request, env, 200, {
    ok: true,
    sessionToken: token,
    role: 'super_admin',
    email: config.superAdminEmail,
    expiresInMs: config.sessionTtlMs
  }, {}, { allowMethods: ALLOW });
}

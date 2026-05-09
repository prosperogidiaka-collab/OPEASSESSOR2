import {
  apiErrorResponse,
  getAllowedOrigins,
  getStateStore,
  hasSupabaseCredentials,
  jsonResponse,
  preflightResponse,
  readEnv
} from './_lib/shared.js';

export async function onRequest(context) {
  const { request, env } = context;
  const preflight = preflightResponse(request, env);
  if (preflight) return preflight;
  if (request.method !== 'GET') {
    return jsonResponse(request, env, 405, { error: 'Method not allowed' });
  }
  try {
    const stateStore = getStateStore(env);
    const allowedOrigins = getAllowedOrigins(env);
    return jsonResponse(request, env, 200, {
      ok: true,
      runtime: 'cloudflare-pages',
      pdfExportSupported: false,
      publicBaseUrl: readEnv(env, 'PUBLIC_BASE_URL').trim().replace(/\/+$/, '') || null,
      storageBackend: stateStore.backend,
      storageDetails: stateStore.details,
      allowedOrigins: allowedOrigins.length ? allowedOrigins : ['same-origin only'],
      dataFile: null,
      supabaseConfigured: hasSupabaseCredentials(env)
    });
  } catch (error) {
    return apiErrorResponse(request, env, error, 'Health check failed');
  }
}

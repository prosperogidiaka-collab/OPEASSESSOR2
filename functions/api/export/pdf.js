import { jsonResponse, preflightResponse } from '../_lib/shared.js';

const ALLOW = 'GET, POST, OPTIONS';

export async function onRequest(context) {
  const { request, env } = context;
  const preflight = preflightResponse(request, env, { allowMethods: ALLOW });
  if (preflight) return preflight;
  if (request.method !== 'GET' && request.method !== 'POST') {
    return jsonResponse(request, env, 405, { error: 'Method not allowed' }, {}, { allowMethods: ALLOW });
  }
  return jsonResponse(request, env, 501, {
    ok: false,
    error: 'Server PDF export is not available on this deployment yet. The app should fall back to browser PDF generation automatically.',
    runtime: 'cloudflare-pages'
  }, {}, { allowMethods: ALLOW });
}

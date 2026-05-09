// Stateless logout endpoint. Sessions are HMAC-signed JWT-style tokens with
// no server-side store, so there's nothing to invalidate here — the client
// just deletes its copy. Returning 200 keeps the app's fire-and-forget POST
// in app.js:2596 quiet in the console.

import { jsonResponse, preflightResponse } from '../_lib/shared.js';

const ALLOW = 'POST, OPTIONS';

export async function onRequest(context) {
  const { request, env } = context;
  const preflight = preflightResponse(request, env, { allowMethods: ALLOW });
  if (preflight) return preflight;
  if (request.method !== 'POST') {
    return jsonResponse(request, env, 405, { error: 'Method not allowed' }, {}, { allowMethods: ALLOW });
  }
  return jsonResponse(request, env, 200, { ok: true }, {}, { allowMethods: ALLOW });
}

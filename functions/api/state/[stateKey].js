import {
  VALID_STATE_KEYS,
  apiErrorResponse,
  getStateStore,
  jsonResponse,
  preflightResponse,
  readJsonBody
} from '../_lib/shared.js';

export async function onRequest(context) {
  const { request, env, params } = context;
  const preflight = preflightResponse(request, env);
  if (preflight) return preflight;
  const rawKey = Array.isArray(params.stateKey) ? params.stateKey[0] : params.stateKey;
  const stateKey = decodeURIComponent((rawKey || '').toString());
  if (!VALID_STATE_KEYS.includes(stateKey)) {
    return jsonResponse(request, env, 404, { error: 'Unknown state key' });
  }
  try {
    const stateStore = getStateStore(env);
    if (request.method === 'GET') {
      return jsonResponse(request, env, 200, {
        key: stateKey,
        value: await stateStore.getStateValue(stateKey)
      });
    }
    if (request.method === 'PUT') {
      const parsed = await readJsonBody(request);
      if (!Object.prototype.hasOwnProperty.call(parsed, 'value')) {
        return jsonResponse(request, env, 400, { error: 'Missing value' });
      }
      await stateStore.putStateValue(stateKey, parsed.value);
      return jsonResponse(request, env, 200, {
        ok: true,
        key: stateKey,
        backend: stateStore.backend
      });
    }
    return jsonResponse(request, env, 405, { error: 'Method not allowed' });
  } catch (error) {
    return apiErrorResponse(request, env, error, 'Failed to update shared state');
  }
}

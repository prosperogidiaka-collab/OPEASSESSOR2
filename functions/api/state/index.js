import {
  apiErrorResponse,
  getStateStore,
  jsonResponse,
  preflightResponse
} from '../_lib/shared.js';

export async function onRequest(context) {
  const { request, env } = context;
  const preflight = preflightResponse(request, env);
  if (preflight) return preflight;
  if (request.method !== 'GET') {
    return jsonResponse(request, env, 405, { error: 'Method not allowed' });
  }
  try {
    const stateStore = getStateStore(env);
    return jsonResponse(request, env, 200, await stateStore.getState());
  } catch (error) {
    return apiErrorResponse(request, env, error, 'Failed to load shared state');
  }
}

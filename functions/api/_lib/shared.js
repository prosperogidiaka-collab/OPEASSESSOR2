// Workers-compatible HTTP helpers and Supabase state-store accessor.
//
// Pages Functions receive `(context)` with `{ request, env, params, ... }`.
// `env` is where bindings and environment variables live — there's no
// `process.env` at request time. Helpers below take `env` so handlers can
// stay pure.

import { createStateStore, VALID_STATE_KEYS } from '../../../state-store.js';

export { VALID_STATE_KEYS };

let cachedStateStore = null;

export function readEnv(env, key, fallback = '') {
  const raw = env && env[key];
  if (raw == null) return fallback;
  return raw.toString();
}

export function getAllowedOrigins(env) {
  return readEnv(env, 'ALLOWED_ORIGINS', '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export function hasSupabaseCredentials(env) {
  return !!(readEnv(env, 'SUPABASE_URL').trim() && readEnv(env, 'SUPABASE_SERVICE_ROLE_KEY').trim());
}

function getCorsOrigin(request, env) {
  const origin = request.headers.get('origin');
  if (!origin) return '';
  const allowed = getAllowedOrigins(env);
  if (allowed.includes('*')) return '*';
  return allowed.includes(origin) ? origin : '';
}

function buildHeaders(request, env, extraHeaders = {}, options = {}) {
  const allowMethods = Array.isArray(options.allowMethods)
    ? options.allowMethods.join(', ')
    : (options.allowMethods || 'GET, PUT, OPTIONS');
  const headers = new Headers();
  headers.set('Cache-Control', 'no-store');
  headers.set('X-Content-Type-Options', 'nosniff');
  const corsOrigin = getCorsOrigin(request, env);
  if (corsOrigin) {
    headers.set('Access-Control-Allow-Origin', corsOrigin);
    headers.set('Access-Control-Allow-Methods', allowMethods);
    headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    headers.set('Vary', 'Origin');
  }
  Object.entries(extraHeaders).forEach(([key, value]) => headers.set(key, value));
  return headers;
}

export function jsonResponse(request, env, status, payload, extraHeaders = {}, options = {}) {
  const headers = buildHeaders(request, env, { 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders }, options);
  return new Response(JSON.stringify(payload), { status, headers });
}

export function preflightResponse(request, env, options = {}) {
  if (request.method !== 'OPTIONS') return null;
  const headers = buildHeaders(request, env, { 'Content-Type': 'text/plain; charset=utf-8' }, options);
  return new Response('', { status: 204, headers });
}

export async function readJsonBody(request) {
  const text = await request.text();
  if (!text || !text.trim()) return {};
  return JSON.parse(text);
}

export function getStateStore(env) {
  if (cachedStateStore) return cachedStateStore;
  if (!hasSupabaseCredentials(env)) {
    const error = new Error('Shared sync requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
    error.statusCode = 503;
    throw error;
  }
  cachedStateStore = createStateStore({
    storageBackend: 'supabase',
    supabaseUrl: readEnv(env, 'SUPABASE_URL').trim(),
    supabaseServiceRoleKey: readEnv(env, 'SUPABASE_SERVICE_ROLE_KEY').trim(),
    supabaseTablePrefix: readEnv(env, 'SUPABASE_TABLE_PREFIX', 'ope_').trim()
  });
  return cachedStateStore;
}

export function apiErrorResponse(request, env, error, fallbackMessage, options = {}) {
  const status = error && error.statusCode ? error.statusCode : 500;
  return jsonResponse(request, env, status, { error: error && error.message ? error.message : fallbackMessage }, {}, options);
}

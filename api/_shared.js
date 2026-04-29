const path = require('path');

const { createStateStore, VALID_STATE_KEYS } = require('../state-store');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : ROOT;
const DATA_FILE = process.env.DATA_FILE
  ? path.resolve(process.env.DATA_FILE)
  : path.join(DATA_DIR, 'ope-shared-state.json');
const STORAGE_BACKEND = (process.env.STORAGE_BACKEND || 'auto').trim();
const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim();
const SUPABASE_SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const SUPABASE_TABLE_PREFIX = (process.env.SUPABASE_TABLE_PREFIX || 'ope_').trim();
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

let cachedStateStore = null;

function isServerlessRuntime() {
  return !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NOW_REGION);
}

function hasSupabaseCredentials() {
  return !!(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
}

function getCorsOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return '';
  if (ALLOWED_ORIGINS.includes('*')) return '*';
  return ALLOWED_ORIGINS.includes(origin) ? origin : '';
}

function applyResponseHeaders(req, res, extraHeaders = {}) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const corsOrigin = getCorsOrigin(req);
  if (corsOrigin) {
    res.setHeader('Access-Control-Allow-Origin', corsOrigin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Vary', 'Origin');
  }
  Object.entries(extraHeaders).forEach(([key, value]) => res.setHeader(key, value));
}

function sendJson(req, res, status, payload, extraHeaders = {}) {
  applyResponseHeaders(req, res, { 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders });
  res.statusCode = status;
  res.end(JSON.stringify(payload));
}

function handlePreflight(req, res) {
  if (req.method !== 'OPTIONS') return false;
  applyResponseHeaders(req, res, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.statusCode = 204;
  res.end('');
  return true;
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string' && req.body.trim()) return JSON.parse(req.body);
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return JSON.parse(raw || '{}');
}

function getStateStore() {
  if (cachedStateStore) return cachedStateStore;
  const requestedBackend = (STORAGE_BACKEND || 'auto').trim().toLowerCase();
  if (isServerlessRuntime()) {
    if (requestedBackend === 'file') {
      const error = new Error('Serverless deployments do not support STORAGE_BACKEND=file for shared sync. Use STORAGE_BACKEND=supabase.');
      error.statusCode = 503;
      throw error;
    }
    if (!hasSupabaseCredentials()) {
      const error = new Error('Shared sync on this deployment requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
      error.statusCode = 503;
      throw error;
    }
  }
  cachedStateStore = createStateStore({
    storageBackend: STORAGE_BACKEND || 'auto',
    dataFile: DATA_FILE,
    supabaseUrl: SUPABASE_URL,
    supabaseServiceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
    supabaseTablePrefix: SUPABASE_TABLE_PREFIX
  });
  return cachedStateStore;
}

function sendApiError(req, res, error, fallbackMessage) {
  const status = error && error.statusCode ? error.statusCode : 500;
  sendJson(req, res, status, { error: error && error.message ? error.message : fallbackMessage });
}

module.exports = {
  ALLOWED_ORIGINS,
  DATA_FILE,
  PUBLIC_BASE_URL,
  VALID_STATE_KEYS,
  getStateStore,
  handlePreflight,
  hasSupabaseCredentials,
  isServerlessRuntime,
  readJsonBody,
  sendApiError,
  sendJson
};

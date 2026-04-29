require('dotenv').config();

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { VALID_STATE_KEYS, createStateStore } = require('./state-store');

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 8000);
const ROOT = __dirname;
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : ROOT;
const DATA_FILE = process.env.DATA_FILE
  ? path.resolve(process.env.DATA_FILE)
  : path.join(DATA_DIR, 'ope-shared-state.json');
const MAX_BODY_BYTES = Number(process.env.MAX_BODY_BYTES || 100 * 1024 * 1024);
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const STORAGE_BACKEND = (process.env.STORAGE_BACKEND || 'file').trim();
const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim();
const SUPABASE_SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const SUPABASE_TABLE_PREFIX = (process.env.SUPABASE_TABLE_PREFIX || 'ope_').trim();

const stateStore = createStateStore({
  storageBackend: STORAGE_BACKEND,
  dataFile: DATA_FILE,
  supabaseUrl: SUPABASE_URL,
  supabaseServiceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
  supabaseTablePrefix: SUPABASE_TABLE_PREFIX
});

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json'
};

function getLocalAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter(Boolean)
    .filter((address) => address.family === 'IPv4' && !address.internal)
    .map((address) => address.address);
}

function getCorsOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return '';
  if (ALLOWED_ORIGINS.includes('*')) return '*';
  return ALLOWED_ORIGINS.includes(origin) ? origin : '';
}

function buildResponseHeaders(req, type, extraHeaders = {}) {
  const headers = {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders
  };
  const corsOrigin = getCorsOrigin(req);
  if (corsOrigin) {
    headers['Access-Control-Allow-Origin'] = corsOrigin;
    headers['Access-Control-Allow-Methods'] = 'GET, PUT, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type';
    headers['Vary'] = headers['Vary'] ? `${headers['Vary']}, Origin` : 'Origin';
  }
  return headers;
}

function send(req, res, status, body, type = 'text/plain; charset=utf-8', extraHeaders = {}) {
  res.writeHead(status, buildResponseHeaders(req, type, extraHeaders));
  res.end(body);
}

function sendJson(req, res, status, payload, extraHeaders = {}) {
  send(req, res, status, JSON.stringify(payload), 'application/json; charset=utf-8', extraHeaders);
}

function resolveRequestPath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const cleanPath = decoded === '/' ? '/index.html' : decoded;
  const filePath = path.resolve(ROOT, '.' + cleanPath);
  if (!filePath.startsWith(ROOT)) return null;
  return filePath;
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (Buffer.byteLength(data) > MAX_BODY_BYTES) {
        reject(new Error('Payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const route = url.pathname;

  if (req.method === 'OPTIONS') {
    return send(req, res, 204, '', 'text/plain; charset=utf-8');
  }

  if (route === '/api/health' && req.method === 'GET') {
    return sendJson(req, res, 200, {
      ok: true,
      host: HOST,
      port: PORT,
      addresses: getLocalAddresses(),
      publicBaseUrl: PUBLIC_BASE_URL || null,
      storageBackend: stateStore.backend,
      storageDetails: stateStore.details,
      maxBodyBytes: MAX_BODY_BYTES,
      allowedOrigins: ALLOWED_ORIGINS.length ? ALLOWED_ORIGINS : ['same-origin only']
    });
  }

  if (route === '/api/state' && req.method === 'GET') {
    try {
      return sendJson(req, res, 200, await stateStore.getState());
    } catch (error) {
      return sendJson(req, res, 500, { error: error.message || 'Failed to load shared state' });
    }
  }

  if (route.startsWith('/api/state/')) {
    const stateKey = decodeURIComponent(route.replace('/api/state/', ''));
    if (!VALID_STATE_KEYS.includes(stateKey)) {
      return sendJson(req, res, 404, { error: 'Unknown state key' });
    }

    if (req.method === 'GET') {
      try {
        const value = await stateStore.getStateValue(stateKey);
        return sendJson(req, res, 200, { key: stateKey, value });
      } catch (error) {
        return sendJson(req, res, 500, { error: error.message || 'Failed to load shared state value' });
      }
    }

    if (req.method === 'PUT') {
      try {
        const body = await readRequestBody(req);
        const parsed = JSON.parse(body || '{}');
        if (!Object.prototype.hasOwnProperty.call(parsed, 'value')) {
          return sendJson(req, res, 400, { error: 'Missing value' });
        }
        await stateStore.putStateValue(stateKey, parsed.value);
        return sendJson(req, res, 200, { ok: true, key: stateKey, backend: stateStore.backend });
      } catch (error) {
        const message = error.message || 'Invalid request body';
        const isBodyError = message === 'Missing value' || message === 'Payload too large' || /JSON/i.test(message);
        return sendJson(req, res, isBodyError ? 400 : 500, { error: message });
      }
    }
  }

  return false;
}

const server = http.createServer(async (req, res) => {
  if ((req.url || '').startsWith('/api/')) {
    const handled = await handleApi(req, res);
    if (handled !== false) return;
    return sendJson(req, res, 404, { error: 'Not found' });
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return send(req, res, 405, 'Method not allowed');
  }

  const filePath = resolveRequestPath(req.url || '/');
  if (!filePath) return send(req, res, 403, 'Forbidden');

  fs.readFile(filePath, (err, data) => {
    if (err) {
      const fallback = path.join(ROOT, 'index.html');
      return fs.readFile(fallback, (fallbackErr, fallbackData) => {
        if (fallbackErr) return send(req, res, 404, 'Not found');
        send(req, res, 200, req.method === 'HEAD' ? '' : fallbackData, TYPES['.html']);
      });
    }

    send(req, res, 200, req.method === 'HEAD' ? '' : data, TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream');
  });
});

server.listen(PORT, HOST, () => {
  console.log(`OPE Assessor server is running at http://localhost:${PORT}`);
  console.log(`Storage backend: ${stateStore.backend}`);
  if (stateStore.backend === 'file') {
    console.log(`Shared quiz data file: ${DATA_FILE}`);
  } else {
    console.log(`Supabase URL: ${SUPABASE_URL}`);
    console.log(`Supabase table prefix: ${SUPABASE_TABLE_PREFIX}`);
  }
  if (PUBLIC_BASE_URL) {
    console.log(`Public base URL: ${PUBLIC_BASE_URL}`);
  }
  console.log(`Allowed CORS origins: ${ALLOWED_ORIGINS.length ? ALLOWED_ORIGINS.join(', ') : 'same-origin only'}`);
  getLocalAddresses().forEach((address) => {
    console.log(`Open from another device on this Wi-Fi: http://${address}:${PORT}`);
  });
});

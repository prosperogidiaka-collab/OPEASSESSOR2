const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

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

const DEFAULT_STATE = {
  quizzes: {},
  submissions: [],
  teachers: {},
  students: {}
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

function ensureParentDirectory(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function resolveRequestPath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const cleanPath = decoded === '/' ? '/index.html' : decoded;
  const filePath = path.resolve(ROOT, '.' + cleanPath);
  if (!filePath.startsWith(ROOT)) return null;
  return filePath;
}

function ensureDataFile() {
  ensureParentDirectory(DATA_FILE);
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(DEFAULT_STATE, null, 2));
  }
}

function readSharedState() {
  ensureDataFile();
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw || '{}');
    return {
      quizzes: parsed.quizzes || {},
      submissions: parsed.submissions || [],
      teachers: parsed.teachers || {},
      students: parsed.students || {}
    };
  } catch (error) {
    console.error('Failed to read shared state, resetting file.', error);
    ensureParentDirectory(DATA_FILE);
    fs.writeFileSync(DATA_FILE, JSON.stringify(DEFAULT_STATE, null, 2));
    return { ...DEFAULT_STATE };
  }
}

function writeSharedState(nextState) {
  ensureParentDirectory(DATA_FILE);
  const tmpFile = `${DATA_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(nextState, null, 2));
  fs.renameSync(tmpFile, DATA_FILE);
}

function recordStamp(item) {
  const raw = item && (item.updatedAt || item.editedAt || item.submittedAt || item.uploadedAt || item.licenseUpdatedAt || item.licenseRequestedAt || item.idChangedAt || item.createdAt || item.startedAt);
  const stamp = raw ? new Date(raw).getTime() : 0;
  return Number.isFinite(stamp) ? stamp : 0;
}

function submissionKey(item, index = 0) {
  const quizId = (item && item.quizId) || '';
  const email = ((item && item.email) || '').toString().trim().toLowerCase();
  const stamp = item && (item.submittedAt || item.updatedAt || item.startedAt || item.createdAt) || `idx-${index}`;
  return `${quizId}::${email}::${stamp}`;
}

function studentKey(item, index = 0) {
  return ((item && (item.email || item.registrationNo || item.id || item.name)) || `student-${index}`).toString().trim().toLowerCase();
}

function mergeStudentLists(currentList = [], incomingList = []) {
  const merged = new Map();
  const add = (item, index) => {
    if (!item || typeof item !== 'object') return;
    const key = studentKey(item, index);
    const current = merged.get(key);
    if (!current || recordStamp(item) >= recordStamp(current)) merged.set(key, item);
  };
  currentList.forEach(add);
  incomingList.forEach(add);
  return Array.from(merged.values()).sort((a, b) => ((a.name || '').localeCompare(b.name || '')));
}

function mergeRecordMaps(currentValue = {}, incomingValue = {}) {
  const merged = { ...(currentValue || {}) };
  Object.keys(incomingValue || {}).forEach((key) => {
    const incomingItem = incomingValue[key];
    const currentItem = currentValue ? currentValue[key] : undefined;
    if (Array.isArray(incomingItem) || Array.isArray(currentItem)) {
      merged[key] = mergeStudentLists(currentItem || [], incomingItem || []);
      return;
    }
    if (!currentItem || recordStamp(incomingItem) >= recordStamp(currentItem)) merged[key] = incomingItem;
  });
  return merged;
}

function mergeTeacherRecord(currentItem = {}, incomingItem = {}) {
  const currentStamp = recordStamp(currentItem);
  const incomingStamp = recordStamp(incomingItem);
  const base = incomingStamp >= currentStamp ? { ...(currentItem || {}), ...(incomingItem || {}) } : { ...(incomingItem || {}), ...(currentItem || {}) };
  const currentLicenseStamp = currentItem && currentItem.licenseUpdatedAt ? new Date(currentItem.licenseUpdatedAt).getTime() : 0;
  const incomingLicenseStamp = incomingItem && incomingItem.licenseUpdatedAt ? new Date(incomingItem.licenseUpdatedAt).getTime() : 0;
  const licenseSource = incomingLicenseStamp >= currentLicenseStamp ? incomingItem : currentItem;
  ['licenseEndsAt', 'licenseStopped', 'licenseRequestStatus', 'licenseUpdatedAt'].forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(licenseSource || {}, field)) base[field] = licenseSource[field];
  });
  return base;
}

function mergeTeacherMaps(currentValue = {}, incomingValue = {}) {
  const merged = {};
  const keys = new Set([...Object.keys(currentValue || {}), ...Object.keys(incomingValue || {})]);
  keys.forEach((key) => {
    merged[key] = mergeTeacherRecord(currentValue ? currentValue[key] : {}, incomingValue ? incomingValue[key] : {});
  });
  return merged;
}

function mergeSubmissionLists(currentList, incomingList) {
  const merged = new Map();
  (currentList || []).forEach((item, index) => merged.set(submissionKey(item, index), item));
  (incomingList || []).forEach((item, index) => merged.set(submissionKey(item, index), item));
  return Array.from(merged.values()).sort((a, b) => {
    const left = new Date(a.submittedAt || a.updatedAt || a.startedAt || 0).getTime();
    const right = new Date(b.submittedAt || b.updatedAt || b.startedAt || 0).getTime();
    return left - right;
  });
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
      storageFile: DATA_FILE,
      maxBodyBytes: MAX_BODY_BYTES,
      allowedOrigins: ALLOWED_ORIGINS.length ? ALLOWED_ORIGINS : ['same-origin only']
    });
  }

  if (route === '/api/state' && req.method === 'GET') {
    return sendJson(req, res, 200, readSharedState());
  }

  if (route.startsWith('/api/state/')) {
    const stateKey = decodeURIComponent(route.replace('/api/state/', ''));
    if (!Object.prototype.hasOwnProperty.call(DEFAULT_STATE, stateKey)) {
      return sendJson(req, res, 404, { error: 'Unknown state key' });
    }

    if (req.method === 'GET') {
      const state = readSharedState();
      return sendJson(req, res, 200, { key: stateKey, value: state[stateKey] });
    }

    if (req.method === 'PUT') {
      try {
        const body = await readRequestBody(req);
        const parsed = JSON.parse(body || '{}');
        if (!Object.prototype.hasOwnProperty.call(parsed, 'value')) {
          return sendJson(req, res, 400, { error: 'Missing value' });
        }
        const state = readSharedState();
        if (stateKey === 'submissions') {
          state[stateKey] = mergeSubmissionLists(state[stateKey], parsed.value);
        } else if (stateKey === 'teachers') {
          state[stateKey] = mergeTeacherMaps(state[stateKey], parsed.value);
        } else if (stateKey === 'quizzes' || stateKey === 'students') {
          state[stateKey] = mergeRecordMaps(state[stateKey], parsed.value);
        } else {
          state[stateKey] = parsed.value;
        }
        writeSharedState(state);
        return sendJson(req, res, 200, { ok: true, key: stateKey });
      } catch (error) {
        return sendJson(req, res, 400, { error: error.message || 'Invalid JSON body' });
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
  console.log(`OPE Assessor sync server is running at http://localhost:${PORT}`);
  if (PUBLIC_BASE_URL) {
    console.log(`Public base URL: ${PUBLIC_BASE_URL}`);
  }
  console.log(`Shared quiz data file: ${DATA_FILE}`);
  console.log(`Allowed CORS origins: ${ALLOWED_ORIGINS.length ? ALLOWED_ORIGINS.join(', ') : 'same-origin only'}`);
  getLocalAddresses().forEach((address) => {
    console.log(`Open from another device on this Wi-Fi: http://${address}:${PORT}`);
  });
});

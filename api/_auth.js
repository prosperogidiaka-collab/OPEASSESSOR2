const { createHmac, timingSafeEqual, pbkdf2Sync, randomBytes } = require('crypto');

const SUPER_ADMIN_EMAIL = (process.env.SUPER_ADMIN_EMAIL || 'prosperogidiaka@gmail.com')
  .toString()
  .trim()
  .toLowerCase();
const SUPER_ADMIN_PASSWORD = (process.env.SUPER_ADMIN_PASSWORD || '7767737Prosper').toString();
const SESSION_TTL_MS = Math.max(60 * 1000, Number(process.env.SESSION_TTL_MS || 24 * 60 * 60 * 1000));
const PBKDF2_ITERATIONS = Math.max(10000, Number(process.env.PBKDF2_ITERATIONS || 100000));
const PBKDF2_KEY_BYTES = 32;
const PBKDF2_SALT_BYTES = 16;

// Stateless serverless invocations cannot share an in-memory session map, so we
// sign each token with HMAC-SHA256 and verify on every request. The secret is
// derived from SESSION_SECRET when set; otherwise we fall back to the admin
// password so existing deployments keep working without extra configuration.
const SESSION_SECRET = (process.env.SESSION_SECRET || `ope-session::${SUPER_ADMIN_PASSWORD}`).toString();

function base64UrlEncode(buf) {
  return Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function base64UrlDecode(str) {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

function signPayload(payloadJson) {
  return createHmac('sha256', SESSION_SECRET).update(payloadJson).digest();
}

function createSessionToken(email, role, ttlMs = SESSION_TTL_MS) {
  const payload = {
    email: (email || '').toString().trim().toLowerCase(),
    role: role || 'teacher',
    expiresAt: Date.now() + ttlMs
  };
  const payloadJson = JSON.stringify(payload);
  const sig = signPayload(payloadJson);
  return `v1.${base64UrlEncode(payloadJson)}.${base64UrlEncode(sig)}`;
}

function verifySessionToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') return null;
  let payloadBuf;
  let sigBuf;
  try {
    payloadBuf = base64UrlDecode(parts[1]);
    sigBuf = base64UrlDecode(parts[2]);
  } catch (error) {
    return null;
  }
  const expected = signPayload(payloadBuf.toString('utf8'));
  if (expected.length !== sigBuf.length) return null;
  try {
    if (!timingSafeEqual(expected, sigBuf)) return null;
  } catch (error) {
    return null;
  }
  let payload;
  try {
    payload = JSON.parse(payloadBuf.toString('utf8'));
  } catch (error) {
    return null;
  }
  if (!payload || typeof payload !== 'object') return null;
  if (!payload.expiresAt || Number(payload.expiresAt) <= Date.now()) return null;
  return payload;
}

function getSessionFromRequest(req) {
  const header = (req.headers && req.headers['authorization'] || '').toString().trim();
  if (!header) return null;
  const match = /^Bearer\s+(\S+)/i.exec(header);
  if (!match) return null;
  const payload = verifySessionToken(match[1]);
  if (!payload) return null;
  return { token: match[1], ...payload };
}

function hashPassword(plain) {
  const salt = randomBytes(PBKDF2_SALT_BYTES);
  const hash = pbkdf2Sync(String(plain || ''), salt, PBKDF2_ITERATIONS, PBKDF2_KEY_BYTES, 'sha256');
  return `pbkdf2-sha256:${PBKDF2_ITERATIONS}:${salt.toString('hex')}:${hash.toString('hex')}`;
}

function verifyPasswordHash(plain, encoded) {
  if (!encoded || typeof encoded !== 'string') return false;
  const parts = encoded.split(':');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2-sha256') return false;
  const iterations = Number(parts[1]);
  if (!Number.isFinite(iterations) || iterations < 1) return false;
  let salt;
  let expected;
  try {
    salt = Buffer.from(parts[2], 'hex');
    expected = Buffer.from(parts[3], 'hex');
  } catch (error) {
    return false;
  }
  if (!salt.length || !expected.length) return false;
  const actual = pbkdf2Sync(String(plain || ''), salt, iterations, expected.length, 'sha256');
  if (actual.length !== expected.length) return false;
  try {
    return timingSafeEqual(actual, expected);
  } catch (error) {
    return false;
  }
}

module.exports = {
  SUPER_ADMIN_EMAIL,
  SUPER_ADMIN_PASSWORD,
  SESSION_TTL_MS,
  createSessionToken,
  verifySessionToken,
  getSessionFromRequest,
  hashPassword,
  verifyPasswordHash
};

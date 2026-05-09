// Workers-compatible auth helpers. Uses node:crypto via nodejs_compat so the
// same PBKDF2 + HMAC scheme as the Vercel build keeps working — that means
// existing teacher password hashes and signed session tokens stay valid after
// the Cloudflare cutover.

import { createHmac, timingSafeEqual, pbkdf2Sync, randomBytes } from 'node:crypto';

const PBKDF2_KEY_BYTES = 32;
const PBKDF2_SALT_BYTES = 16;

export function getAuthConfig(env) {
  const superAdminEmail = ((env && env.SUPER_ADMIN_EMAIL) || 'prosperogidiaka@gmail.com').toString().trim().toLowerCase();
  const superAdminPassword = ((env && env.SUPER_ADMIN_PASSWORD) || '7767737Prosper').toString();
  const sessionTtlMs = Math.max(60 * 1000, Number((env && env.SESSION_TTL_MS) || 24 * 60 * 60 * 1000));
  const pbkdf2Iterations = Math.max(10000, Number((env && env.PBKDF2_ITERATIONS) || 100000));
  const sessionSecret = ((env && env.SESSION_SECRET) || `ope-session::${superAdminPassword}`).toString();
  return { superAdminEmail, superAdminPassword, sessionTtlMs, pbkdf2Iterations, sessionSecret };
}

function base64UrlEncode(buf) {
  return Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function base64UrlDecode(str) {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

function signPayload(secret, payloadJson) {
  return createHmac('sha256', secret).update(payloadJson).digest();
}

export function createSessionToken(env, email, role, ttlMs) {
  const config = getAuthConfig(env);
  const payload = {
    email: (email || '').toString().trim().toLowerCase(),
    role: role || 'teacher',
    expiresAt: Date.now() + (ttlMs || config.sessionTtlMs)
  };
  const payloadJson = JSON.stringify(payload);
  const sig = signPayload(config.sessionSecret, payloadJson);
  return `v1.${base64UrlEncode(payloadJson)}.${base64UrlEncode(sig)}`;
}

export function verifySessionToken(env, token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') return null;
  const config = getAuthConfig(env);
  let payloadBuf;
  let sigBuf;
  try {
    payloadBuf = base64UrlDecode(parts[1]);
    sigBuf = base64UrlDecode(parts[2]);
  } catch (error) {
    return null;
  }
  const expected = signPayload(config.sessionSecret, payloadBuf.toString('utf8'));
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

export function getSessionFromRequest(env, request) {
  const header = (request.headers.get('authorization') || '').toString().trim();
  if (!header) return null;
  const match = /^Bearer\s+(\S+)/i.exec(header);
  if (!match) return null;
  const payload = verifySessionToken(env, match[1]);
  if (!payload) return null;
  return { token: match[1], ...payload };
}

export function hashPassword(env, plain) {
  const config = getAuthConfig(env);
  const salt = randomBytes(PBKDF2_SALT_BYTES);
  const hash = pbkdf2Sync(String(plain || ''), salt, config.pbkdf2Iterations, PBKDF2_KEY_BYTES, 'sha256');
  return `pbkdf2-sha256:${config.pbkdf2Iterations}:${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function verifyPasswordHash(plain, encoded) {
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

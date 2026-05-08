const { handlePreflight, readJsonBody, sendJson, getStateStore, sendApiError } = require('../../_shared');
const {
  SUPER_ADMIN_EMAIL,
  SESSION_TTL_MS,
  createSessionToken,
  hashPassword,
  verifyPasswordHash
} = require('../../_auth');

module.exports = async function teacherLoginHandler(req, res) {
  if (handlePreflight(req, res, { allowMethods: 'POST, OPTIONS' })) return;
  if (req.method !== 'POST') {
    return sendJson(req, res, 405, { error: 'Method not allowed' }, {}, { allowMethods: 'POST, OPTIONS' });
  }
  let parsed;
  try {
    parsed = await readJsonBody(req);
  } catch (error) {
    return sendJson(req, res, 400, { error: 'Invalid JSON body' }, {}, { allowMethods: 'POST, OPTIONS' });
  }
  const email = (parsed.email || '').toString().trim().toLowerCase();
  const password = (parsed.password || '').toString();
  if (!email || !password) {
    return sendJson(req, res, 400, { error: 'Email and password are required' }, {}, { allowMethods: 'POST, OPTIONS' });
  }
  if (email === SUPER_ADMIN_EMAIL) {
    return sendJson(req, res, 401, { error: 'Use the admin login for this account' }, {}, { allowMethods: 'POST, OPTIONS' });
  }
  try {
    const stateStore = getStateStore();
    const teachers = (await stateStore.getStateValue('teachers')) || {};
    const record = teachers && teachers[email];
    if (!record || typeof record !== 'object') {
      return sendJson(req, res, 401, { error: 'Invalid teacher ID or password' }, {}, { allowMethods: 'POST, OPTIONS' });
    }
    let ok = false;
    let migratedRecord = null;
    if (record.passwordHash) {
      ok = verifyPasswordHash(password, record.passwordHash);
    } else if (typeof record.password === 'string' && record.password) {
      // Lazy-migrate: legacy plaintext password matches → upgrade to PBKDF2 hash now.
      if (record.password === password) {
        ok = true;
        migratedRecord = { ...record, passwordHash: hashPassword(password), passwordResetAt: new Date().toISOString() };
        delete migratedRecord.password;
      }
    }
    if (!ok) {
      return sendJson(req, res, 401, { error: 'Invalid teacher ID or password' }, {}, { allowMethods: 'POST, OPTIONS' });
    }
    if (migratedRecord) {
      try {
        await stateStore.putStateValue('teachers', { [email]: migratedRecord });
      } catch (error) {
        // Migration failures are non-fatal — login still succeeds.
      }
    }
    const token = createSessionToken(email, 'teacher');
    return sendJson(
      req,
      res,
      200,
      { ok: true, sessionToken: token, role: 'teacher', email, expiresInMs: SESSION_TTL_MS },
      {},
      { allowMethods: 'POST, OPTIONS' }
    );
  } catch (error) {
    return sendApiError(req, res, error, 'Failed to verify teacher login');
  }
};

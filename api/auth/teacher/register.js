const { handlePreflight, readJsonBody, sendJson, getStateStore, sendApiError } = require('../../_shared');
const {
  SUPER_ADMIN_EMAIL,
  SESSION_TTL_MS,
  createSessionToken,
  hashPassword
} = require('../../_auth');

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

module.exports = async function teacherRegisterHandler(req, res) {
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
  const profile = isPlainObject(parsed.profile) ? parsed.profile : {};
  if (!email || !password) {
    return sendJson(req, res, 400, { error: 'Email and password are required' }, {}, { allowMethods: 'POST, OPTIONS' });
  }
  if (password.length < 4) {
    return sendJson(req, res, 400, { error: 'Password must be at least 4 characters' }, {}, { allowMethods: 'POST, OPTIONS' });
  }
  if (email === SUPER_ADMIN_EMAIL) {
    return sendJson(req, res, 409, { error: 'Admin account already exists. Login instead.' }, {}, { allowMethods: 'POST, OPTIONS' });
  }
  try {
    const stateStore = getStateStore();
    const teachers = (await stateStore.getStateValue('teachers')) || {};
    if (teachers[email]) {
      return sendJson(req, res, 409, { error: 'Teacher ID already exists. Login instead.' }, {}, { allowMethods: 'POST, OPTIONS' });
    }
    const now = new Date().toISOString();
    const cleanProfile = { ...profile };
    delete cleanProfile.password;
    delete cleanProfile.passwordHash;
    const newRecord = {
      ...cleanProfile,
      teacherId: email,
      email,
      passwordHash: hashPassword(password),
      role: 'teacher',
      name: cleanProfile.name || '',
      phone: cleanProfile.phone || '',
      tokenBalance: cleanProfile.tokenBalance ?? 0,
      tokenUpdatedAt: now,
      tokenRequestStatus: cleanProfile.tokenRequestStatus || '',
      unlimitedExpiresAt: cleanProfile.unlimitedExpiresAt || '',
      unlimitedDeviceId: cleanProfile.unlimitedDeviceId || '',
      createdAt: now,
      updatedAt: now,
      passwordResetAt: now
    };
    await stateStore.putStateValue('teachers', { [email]: newRecord });
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
    return sendApiError(req, res, error, 'Failed to create teacher account');
  }
};

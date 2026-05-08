const { handlePreflight, readJsonBody, sendJson, getStateStore, sendApiError } = require('../../_shared');
const {
  getSessionFromRequest,
  hashPassword,
  verifyPasswordHash
} = require('../../_auth');

module.exports = async function teacherChangePasswordHandler(req, res) {
  if (handlePreflight(req, res, { allowMethods: 'POST, OPTIONS' })) return;
  if (req.method !== 'POST') {
    return sendJson(req, res, 405, { error: 'Method not allowed' }, {}, { allowMethods: 'POST, OPTIONS' });
  }
  const session = getSessionFromRequest(req);
  if (!session) {
    return sendJson(req, res, 401, { error: 'Not authenticated' }, {}, { allowMethods: 'POST, OPTIONS' });
  }
  if (session.role !== 'teacher') {
    return sendJson(req, res, 403, { error: 'Only teacher accounts can change their own password here' }, {}, { allowMethods: 'POST, OPTIONS' });
  }
  let parsed;
  try {
    parsed = await readJsonBody(req);
  } catch (error) {
    return sendJson(req, res, 400, { error: 'Invalid JSON body' }, {}, { allowMethods: 'POST, OPTIONS' });
  }
  const currentPassword = (parsed.currentPassword || '').toString();
  const newPassword = (parsed.newPassword || '').toString();
  if (!newPassword || newPassword.length < 4) {
    return sendJson(req, res, 400, { error: 'New password must be at least 4 characters' }, {}, { allowMethods: 'POST, OPTIONS' });
  }
  try {
    const stateStore = getStateStore();
    const teachers = (await stateStore.getStateValue('teachers')) || {};
    const record = teachers[session.email];
    if (!record) {
      return sendJson(req, res, 404, { error: 'Teacher not found' }, {}, { allowMethods: 'POST, OPTIONS' });
    }
    let currentOk = false;
    if (record.passwordHash) currentOk = verifyPasswordHash(currentPassword, record.passwordHash);
    else if (typeof record.password === 'string') currentOk = record.password === currentPassword;
    if (!currentOk) {
      return sendJson(req, res, 401, { error: 'Current password is incorrect' }, {}, { allowMethods: 'POST, OPTIONS' });
    }
    const now = new Date().toISOString();
    const updated = { ...record, passwordHash: hashPassword(newPassword), updatedAt: now, passwordResetAt: now };
    delete updated.password;
    await stateStore.putStateValue('teachers', { [session.email]: updated });
    return sendJson(req, res, 200, { ok: true }, {}, { allowMethods: 'POST, OPTIONS' });
  } catch (error) {
    return sendApiError(req, res, error, 'Failed to change password');
  }
};

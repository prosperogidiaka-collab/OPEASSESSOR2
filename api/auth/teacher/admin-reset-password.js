const { handlePreflight, readJsonBody, sendJson, getStateStore, sendApiError } = require('../../_shared');
const {
  SUPER_ADMIN_EMAIL,
  getSessionFromRequest,
  hashPassword
} = require('../../_auth');

module.exports = async function teacherAdminResetPasswordHandler(req, res) {
  if (handlePreflight(req, res, { allowMethods: 'POST, OPTIONS' })) return;
  if (req.method !== 'POST') {
    return sendJson(req, res, 405, { error: 'Method not allowed' }, {}, { allowMethods: 'POST, OPTIONS' });
  }
  const session = getSessionFromRequest(req);
  if (!session || session.role !== 'super_admin') {
    return sendJson(req, res, 403, { error: 'Admin authentication required' }, {}, { allowMethods: 'POST, OPTIONS' });
  }
  let parsed;
  try {
    parsed = await readJsonBody(req);
  } catch (error) {
    return sendJson(req, res, 400, { error: 'Invalid JSON body' }, {}, { allowMethods: 'POST, OPTIONS' });
  }
  const teacherEmail = (parsed.teacherEmail || '').toString().trim().toLowerCase();
  const newPassword = (parsed.newPassword || '').toString();
  if (!teacherEmail || !newPassword) {
    return sendJson(req, res, 400, { error: 'Teacher email and new password required' }, {}, { allowMethods: 'POST, OPTIONS' });
  }
  if (newPassword.length < 4) {
    return sendJson(req, res, 400, { error: 'Password must be at least 4 characters' }, {}, { allowMethods: 'POST, OPTIONS' });
  }
  if (teacherEmail === SUPER_ADMIN_EMAIL) {
    return sendJson(req, res, 400, { error: 'Admin password is set via environment variables, not the API' }, {}, { allowMethods: 'POST, OPTIONS' });
  }
  try {
    const stateStore = getStateStore();
    const teachers = (await stateStore.getStateValue('teachers')) || {};
    const record = teachers[teacherEmail];
    if (!record) {
      return sendJson(req, res, 404, { error: 'Teacher not found' }, {}, { allowMethods: 'POST, OPTIONS' });
    }
    const now = new Date().toISOString();
    const updated = { ...record, passwordHash: hashPassword(newPassword), updatedAt: now, passwordResetAt: now };
    delete updated.password;
    await stateStore.putStateValue('teachers', { [teacherEmail]: updated });
    return sendJson(req, res, 200, { ok: true }, {}, { allowMethods: 'POST, OPTIONS' });
  } catch (error) {
    return sendApiError(req, res, error, 'Failed to reset teacher password');
  }
};

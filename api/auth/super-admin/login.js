const { handlePreflight, readJsonBody, sendJson } = require('../../_shared');
const {
  SUPER_ADMIN_EMAIL,
  SUPER_ADMIN_PASSWORD,
  SESSION_TTL_MS,
  createSessionToken
} = require('../../_auth');

module.exports = async function superAdminLoginHandler(req, res) {
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
  if (email !== SUPER_ADMIN_EMAIL || password !== SUPER_ADMIN_PASSWORD) {
    return sendJson(req, res, 401, { error: 'Invalid admin email or password' }, {}, { allowMethods: 'POST, OPTIONS' });
  }
  const token = createSessionToken(SUPER_ADMIN_EMAIL, 'super_admin');
  return sendJson(
    req,
    res,
    200,
    {
      ok: true,
      sessionToken: token,
      role: 'super_admin',
      email: SUPER_ADMIN_EMAIL,
      expiresInMs: SESSION_TTL_MS
    },
    {},
    { allowMethods: 'POST, OPTIONS' }
  );
};

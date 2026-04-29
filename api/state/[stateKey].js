const {
  VALID_STATE_KEYS,
  getStateStore,
  handlePreflight,
  readJsonBody,
  sendApiError,
  sendJson
} = require('../_shared');

function getRequestedStateKey(req) {
  const raw = req.query && req.query.stateKey;
  if (Array.isArray(raw)) return raw[0] || '';
  return raw || '';
}

module.exports = async function stateKeyHandler(req, res) {
  if (handlePreflight(req, res)) return;
  const stateKey = decodeURIComponent(getRequestedStateKey(req));
  if (!VALID_STATE_KEYS.includes(stateKey)) {
    return sendJson(req, res, 404, { error: 'Unknown state key' });
  }
  try {
    const stateStore = getStateStore();
    if (req.method === 'GET') {
      return sendJson(req, res, 200, {
        key: stateKey,
        value: await stateStore.getStateValue(stateKey)
      });
    }
    if (req.method === 'PUT') {
      const parsed = await readJsonBody(req);
      if (!Object.prototype.hasOwnProperty.call(parsed, 'value')) {
        return sendJson(req, res, 400, { error: 'Missing value' });
      }
      await stateStore.putStateValue(stateKey, parsed.value);
      return sendJson(req, res, 200, {
        ok: true,
        key: stateKey,
        backend: stateStore.backend
      });
    }
    return sendJson(req, res, 405, { error: 'Method not allowed' });
  } catch (error) {
    return sendApiError(req, res, error, 'Failed to update shared state');
  }
};

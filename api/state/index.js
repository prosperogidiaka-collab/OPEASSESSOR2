const {
  getStateStore,
  handlePreflight,
  sendApiError,
  sendJson
} = require('../_shared');

module.exports = async function stateHandler(req, res) {
  if (handlePreflight(req, res)) return;
  if (req.method !== 'GET') {
    return sendJson(req, res, 405, { error: 'Method not allowed' });
  }
  try {
    const stateStore = getStateStore();
    return sendJson(req, res, 200, await stateStore.getState());
  } catch (error) {
    return sendApiError(req, res, error, 'Failed to load shared state');
  }
};

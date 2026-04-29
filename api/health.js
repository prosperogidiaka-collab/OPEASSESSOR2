const {
  ALLOWED_ORIGINS,
  DATA_FILE,
  PUBLIC_BASE_URL,
  getStateStore,
  handlePreflight,
  hasSupabaseCredentials,
  isServerlessRuntime,
  sendApiError,
  sendJson
} = require('./_shared');

module.exports = async function healthHandler(req, res) {
  if (handlePreflight(req, res)) return;
  if (req.method !== 'GET') {
    return sendJson(req, res, 405, { error: 'Method not allowed' });
  }
  try {
    const stateStore = getStateStore();
    return sendJson(req, res, 200, {
      ok: true,
      runtime: isServerlessRuntime() ? 'serverless' : 'node',
      publicBaseUrl: PUBLIC_BASE_URL || null,
      storageBackend: stateStore.backend,
      storageDetails: stateStore.details,
      allowedOrigins: ALLOWED_ORIGINS.length ? ALLOWED_ORIGINS : ['same-origin only'],
      dataFile: stateStore.backend === 'file' ? DATA_FILE : null,
      supabaseConfigured: hasSupabaseCredentials()
    });
  } catch (error) {
    return sendApiError(req, res, error, 'Health check failed');
  }
};

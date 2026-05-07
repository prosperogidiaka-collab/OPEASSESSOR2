const {
  handlePreflight,
  sendJson
} = require('../_shared');

module.exports = async function pdfExportHandler(req, res) {
  if (handlePreflight(req, res, { allowMethods: ['GET', 'POST', 'OPTIONS'] })) return;
  if (req.method !== 'GET' && req.method !== 'POST') {
    return sendJson(req, res, 405, { error: 'Method not allowed' }, {}, { allowMethods: ['GET', 'POST', 'OPTIONS'] });
  }
  return sendJson(req, res, 501, {
    ok: false,
    error: 'Server PDF export is not available on this deployment yet. The app should fall back to browser PDF generation automatically.',
    runtime: 'serverless'
  }, {}, { allowMethods: ['GET', 'POST', 'OPTIONS'] });
};

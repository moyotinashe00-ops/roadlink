class AppError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code || `E${status}`;
  }
}
const badRequest = (m, c) => new AppError(400, m, c || 'BAD_REQUEST');
const unauthorized = (m = 'Authentication required') => new AppError(401, m, 'UNAUTHORIZED');
const forbidden = (m = 'You do not have permission to do that') => new AppError(403, m, 'FORBIDDEN');
const notFound = (m = 'Not found') => new AppError(404, m, 'NOT_FOUND');
const conflict = (m, c) => new AppError(409, m, c || 'CONFLICT');

function notFoundHandler(req, res) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${req.path}` } });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message } });
  }
  // body-parser / multer style errors
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'BAD_JSON', message: 'Request body is not valid JSON' } });
  }
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: { code: 'FILE_TOO_LARGE', message: 'Photo must be 5 MB or smaller' } });
  }
  // Postgres: invalid uuid / unique violation / check violation
  if (err.code === '22P02') return res.status(400).json({ error: { code: 'BAD_ID', message: 'Malformed identifier' } });
  if (err.code === '23505') return res.status(409).json({ error: { code: 'DUPLICATE', message: 'That value is already in use' } });
  if (err.code === '23514' || err.code === '23503') {
    return res.status(400).json({ error: { code: 'CONSTRAINT', message: 'Value rejected by a database constraint' } });
  }
  console.error('[error]', err);
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong on our side' } });
}

module.exports = { AppError, badRequest, unauthorized, forbidden, notFound, conflict, notFoundHandler, errorHandler };

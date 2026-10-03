// Wraps an async Express handler so a thrown/rejected error reaches the
// centralized error handler below instead of needing a try/catch in every
// controller method.
function asyncHandler(fn) {
  return (req, res, next) => fn(req, res, next).catch(next);
}

// A controller throws `new HttpError(404, 'Classroom not found')` to control
// the status code; anything else (a bug, a Mongo error) falls back to 500.
class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const statusCode = err.statusCode || 500;
  if (statusCode === 500) console.error('[UNHANDLED ERROR]', err);
  res.status(statusCode).json({ error: err.message || 'Internal server error' });
}

module.exports = { asyncHandler, HttpError, errorHandler };

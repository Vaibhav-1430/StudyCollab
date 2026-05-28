const config = require('../config/env');
const logger = require('../utils/logger');

const errorHandler = (err, req, res, next) => {
  let status = err.statusCode || err.status || 500;
  let message = err.message || 'Server error';

  if (err.code === 'LIMIT_FILE_SIZE') {
    status = 413;
    message = 'File too large';
  }

  if (err.name === 'CastError') {
    status = 400;
    message = 'Invalid identifier';
  }

  if (err.name === 'ValidationError') {
    status = 400;
    message = 'Validation failed';
  }

  if (/CORS/i.test(message)) {
    status = 403;
    message = 'Origin not allowed';
  }

  logger.error('request_error', {
    requestId: req.id,
    method: req.method,
    path: req.originalUrl,
    status,
    error: err.message,
    stack: config.isProduction ? undefined : err.stack
  });

  res.status(status).json({
    message: status >= 500 && config.isProduction ? 'Server error' : message,
    requestId: req.id
  });
};

module.exports = errorHandler;

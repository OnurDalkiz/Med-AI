// Async route handler wrapper — catches errors and forwards to Express error middleware
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// Central error handling middleware
function errorHandler(err, req, res, next) {
  // Multer file size error
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'Dosya boyutu çok büyük (max 50MB)' });
  }

  // Multer file type error
  if (err.message === 'Desteklenmeyen dosya formatı') {
    return res.status(415).json({ error: err.message });
  }

  const status = err.status || 500;
  const message = status === 500 ? 'Sunucu hatası' : err.message;

  const logger = require('./logger');
  logger.error('HTTP', `${req.method} ${req.path} → ${status}: ${err.message}`, err);

  res.status(status).json({ error: message });
}

module.exports = { asyncHandler, errorHandler };

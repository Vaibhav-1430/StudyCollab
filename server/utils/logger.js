const config = require('../config/env');

const levels = ['debug', 'info', 'warn', 'error'];
const currentLevel = levels.indexOf(config.logging.level);

const redact = (value) => {
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => {
      if (/secret|token|password|credential|key/i.test(key)) return [key, '[redacted]'];
      return [key, entry];
    })
  );
};

const write = (level, message, meta = {}) => {
  if (levels.indexOf(level) < currentLevel) return;
  const payload = {
    time: new Date().toISOString(),
    level,
    service: config.appName,
    message,
    ...redact(meta)
  };
  const line = JSON.stringify(payload);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
};

module.exports = {
  debug: (message, meta) => write('debug', message, meta),
  info: (message, meta) => write('info', message, meta),
  warn: (message, meta) => write('warn', message, meta),
  error: (message, meta) => write('error', message, meta)
};

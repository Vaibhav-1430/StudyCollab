const sanitizeHtml = require('sanitize-html');

const sanitizeString = (value) =>
  sanitizeHtml(String(value || ''), {
    allowedTags: [],
    allowedAttributes: {}
  }).trim();

const sanitizeObject = (obj, keys = []) => {
  const out = {};
  keys.forEach((key) => {
    if (obj[key] !== undefined) {
      out[key] = sanitizeString(obj[key]);
    }
  });
  return out;
};

module.exports = { sanitizeString, sanitizeObject };

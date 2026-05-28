const cloudinary = require('cloudinary').v2;
const config = require('./env');

const initCloudinary = () => {
  if (
    !config.cloudinary.cloudName ||
    !config.cloudinary.apiKey ||
    !config.cloudinary.apiSecret
  ) {
    return null;
  }

  cloudinary.config({
    cloud_name: config.cloudinary.cloudName,
    api_key: config.cloudinary.apiKey,
    api_secret: config.cloudinary.apiSecret,
    secure: true
  });

  return cloudinary;
};

module.exports = { initCloudinary };

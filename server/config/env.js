const path = require('path');
const dotenv = require('dotenv');

const nodeEnv = process.env.NODE_ENV || 'development';
const envFile = nodeEnv === 'production' ? '.env.production' : '.env.development';

dotenv.config({
  path: path.join(__dirname, '..', '..', '.env'),
  override: false
});
dotenv.config({
  path: path.join(__dirname, '..', '..', envFile),
  override: false
});

const toInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toList = (value, fallback = []) =>
  String(value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .concat(fallback)
    .filter((entry, index, list) => list.indexOf(entry) === index);

const requireValue = (key, value) => {
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
};

const isProduction = nodeEnv === 'production';
const port = toInt(process.env.PORT, 4000);
const clientUrl = process.env.CLIENT_URL || `http://localhost:${port}`;
const corsOrigins = toList(process.env.CORS_ORIGINS, isProduction ? [] : [clientUrl]);

if (!corsOrigins.length) {
  corsOrigins.push(clientUrl);
}

const config = {
  nodeEnv,
  isProduction,
  port,
  appName: process.env.APP_NAME || 'study-collab-platform',
  clientUrl,
  corsOrigins,
  trustProxy: toInt(process.env.TRUST_PROXY, isProduction ? 1 : 0),
  mongo: {
    uri: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/study-collab',
    connectTimeoutMS: toInt(process.env.MONGO_CONNECT_TIMEOUT_MS, 10000),
    socketTimeoutMS: toInt(process.env.MONGO_SOCKET_TIMEOUT_MS, 45000),
    serverSelectionTimeoutMS: toInt(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS, 10000),
    maxPoolSize: toInt(process.env.MONGO_MAX_POOL_SIZE, isProduction ? 20 : 10),
    minPoolSize: toInt(process.env.MONGO_MIN_POOL_SIZE, 0),
    maxRetries: toInt(process.env.MONGO_CONNECT_RETRIES, 5),
    retryDelayMS: toInt(process.env.MONGO_RETRY_DELAY_MS, 2500),
    autoIndex: process.env.MONGO_AUTO_INDEX
      ? process.env.MONGO_AUTO_INDEX === 'true'
      : !isProduction
  },
  jwt: {
    secret: requireValue('JWT_SECRET', process.env.JWT_SECRET),
    expiresIn: process.env.JWT_EXPIRES_IN || '7d'
  },
  rateLimit: {
    windowMs: toInt(process.env.RATE_LIMIT_WINDOW_MS, 60 * 1000),
    max: toInt(process.env.RATE_LIMIT_MAX, isProduction ? 120 : 300)
  },
  uploads: {
    maxFileSizeMB: toInt(process.env.MAX_FILE_SIZE_MB, 20),
    allowedMimeTypes: toList(
      process.env.ALLOWED_UPLOAD_MIME_TYPES,
      [
        'image/png',
        'image/jpeg',
        'image/webp',
        'image/gif',
        'application/pdf',
        'text/plain',
        'text/markdown'
      ]
    )
  },
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    apiKey: process.env.CLOUDINARY_API_KEY,
    apiSecret: process.env.CLOUDINARY_API_SECRET,
    folder: process.env.CLOUDINARY_FOLDER || 'study-collab'
  },
  webrtc: {
    stunUrls: toList(process.env.STUN_URLS, [
      'stun:stun.l.google.com:19302',
      'stun:global.stun.twilio.com:3478'
    ]),
    turnUrls: toList(process.env.TURN_URLS),
    turnUsername: process.env.TURN_USERNAME,
    turnCredential: process.env.TURN_CREDENTIAL
  },
  socket: {
    pingTimeout: toInt(process.env.SOCKET_PING_TIMEOUT_MS, 20000),
    pingInterval: toInt(process.env.SOCKET_PING_INTERVAL_MS, 25000),
    maxHttpBufferSize: toInt(process.env.SOCKET_MAX_HTTP_BUFFER_SIZE, 1_000_000)
  },
  logging: {
    level: process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug')
  }
};

if (isProduction) {
  requireValue('MONGO_URI', process.env.MONGO_URI);
  requireValue('CLIENT_URL', process.env.CLIENT_URL);
  requireValue('CLOUDINARY_CLOUD_NAME', config.cloudinary.cloudName);
  requireValue('CLOUDINARY_API_KEY', config.cloudinary.apiKey);
  requireValue('CLOUDINARY_API_SECRET', config.cloudinary.apiSecret);
  if (config.jwt.secret.length < 32 || config.jwt.secret === 'change_me') {
    throw new Error('JWT_SECRET must be a strong production secret of at least 32 characters');
  }
  if (!process.env.CORS_ORIGINS) {
    throw new Error('CORS_ORIGINS must be set in production');
  }
}

module.exports = config;

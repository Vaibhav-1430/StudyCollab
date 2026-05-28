const path = require('path');
const http = require('http');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');

const config = require('./config/env');
const { connectDB, disconnectDB } = require('./config/db');
const rateLimit = require('./middleware/rateLimit');
const requestId = require('./middleware/requestId');
const errorHandler = require('./middleware/error');
const logger = require('./utils/logger');

const app = express();

const corsOrigin = (origin, callback) => {
  if (!origin || config.corsOrigins.includes(origin)) return callback(null, true);
  return callback(new Error('Not allowed by CORS'));
};

app.disable('x-powered-by');
app.set('trust proxy', config.trustProxy);

app.use(requestId);
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "default-src": ["'self'"],
        "script-src": ["'self'"],
        "style-src": ["'self'", 'https://fonts.googleapis.com', "'unsafe-inline'"],
        "font-src": ["'self'", 'https://fonts.gstatic.com'],
        "img-src": ["'self'", 'data:', 'blob:', 'https:'],
        "media-src": ["'self'", 'blob:', 'https:'],
        "connect-src": ["'self'", ...config.corsOrigins, 'wss:', 'https:'],
        "frame-src": ["'self'", 'blob:', 'https:']
      }
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    referrerPolicy: { policy: 'no-referrer' }
  })
);
app.use(
  cors({
    origin: corsOrigin,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id']
  })
);
app.use(compression());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(
  morgan(config.isProduction ? 'combined' : 'tiny', {
    stream: {
      write: (message) => logger.info('http_request', { message: message.trim() })
    }
  })
);

app.use(express.static(path.join(__dirname, '..', 'public'), {
  maxAge: config.isProduction ? '1d' : 0,
  etag: true,
  setHeaders: (res, filePath) => {
    if (/\.(js|css|png|jpg|jpeg|webp|gif|ico|svg|woff2?)$/i.test(filePath)) {
      res.setHeader('Cache-Control', config.isProduction ? 'public, max-age=86400' : 'no-cache');
    }
  }
}));

app.use(require('./routes/health'));
app.use(rateLimit);
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/rooms', require('./routes/rooms'));
app.use('/api/friends', require('./routes/friends'));
app.use('/api/files', require('./routes/files'));
app.use('/api/whiteboard', require('./routes/whiteboard'));
app.use('/api/config', require('./routes/config'));

const publicDir = path.join(__dirname, '..', 'public');
app.get('/favicon.ico', (req, res) => res.status(204).end());
app.get('/', (req, res) => res.sendFile(path.join(publicDir, 'index.html')));
app.get('/login', (req, res) => res.sendFile(path.join(publicDir, 'login.html')));
app.get('/register', (req, res) => res.sendFile(path.join(publicDir, 'register.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(publicDir, 'dashboard.html')));
app.get('/room/:code', (req, res) => res.sendFile(path.join(publicDir, 'room.html')));

app.use((req, res) => {
  res.status(404).json({ message: 'Not found', requestId: req.id });
});
app.use(errorHandler);

const server = http.createServer(app);
const { Server } = require('socket.io');
const io = new Server(server, {
  cors: {
    origin: corsOrigin,
    credentials: true
  },
  pingTimeout: config.socket.pingTimeout,
  pingInterval: config.socket.pingInterval,
  maxHttpBufferSize: config.socket.maxHttpBufferSize,
  connectionStateRecovery: {
    maxDisconnectionDuration: 2 * 60 * 1000,
    skipMiddlewares: false
  }
});

app.set('io', io);
require('./socket')(io);

let shuttingDown = false;

const gracefulShutdown = async (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.warn('Graceful shutdown started', { signal });
  server.close(async (err) => {
    if (err) logger.error('HTTP server shutdown error', { error: err.message });
    try {
      io.close();
      await disconnectDB();
      logger.info('Graceful shutdown complete');
      process.exit(err ? 1 : 0);
    } catch (shutdownErr) {
      logger.error('Graceful shutdown failed', { error: shutdownErr.message });
      process.exit(1);
    }
  });
  setTimeout(() => {
    logger.error('Graceful shutdown timed out');
    process.exit(1);
  }, 15000).unref();
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', { error: reason?.message || String(reason) });
});
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { error: err.message, stack: err.stack });
  gracefulShutdown('uncaughtException');
});

const bootstrap = async () => {
  await connectDB();
  server.listen(config.port, () => {
    logger.info('Server started', {
      port: config.port,
      environment: config.nodeEnv,
      corsOrigins: config.corsOrigins,
      health: '/healthz'
    });
  });
};

bootstrap().catch((err) => {
  logger.error('Startup failed', { error: err.message, stack: err.stack });
  process.exit(1);
});

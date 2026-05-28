const mongoose = require('mongoose');
const config = require('./env');
const logger = require('../utils/logger');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const connectionOptions = {
  autoIndex: config.mongo.autoIndex,
  connectTimeoutMS: config.mongo.connectTimeoutMS,
  socketTimeoutMS: config.mongo.socketTimeoutMS,
  serverSelectionTimeoutMS: config.mongo.serverSelectionTimeoutMS,
  maxPoolSize: config.mongo.maxPoolSize,
  minPoolSize: config.mongo.minPoolSize
};

mongoose.connection.on('connected', () => {
  logger.info('MongoDB connected', {
    host: mongoose.connection.host,
    database: mongoose.connection.name
  });
});

mongoose.connection.on('reconnected', () => {
  logger.info('MongoDB reconnected');
});

mongoose.connection.on('disconnected', () => {
  logger.warn('MongoDB disconnected');
});

mongoose.connection.on('error', (err) => {
  logger.error('MongoDB connection error', { error: err.message });
});

const connectDB = async () => {
  let lastError;
  for (let attempt = 1; attempt <= config.mongo.maxRetries; attempt += 1) {
    try {
      logger.info('Connecting to MongoDB', {
        attempt,
        maxRetries: config.mongo.maxRetries,
        pool: `${config.mongo.minPoolSize}-${config.mongo.maxPoolSize}`
      });
      await mongoose.connect(config.mongo.uri, connectionOptions);
      await mongoose.connection.db.admin().ping();
      return mongoose.connection;
    } catch (err) {
      lastError = err;
      logger.error('MongoDB connection attempt failed', {
        attempt,
        error: err.message
      });
      if (attempt < config.mongo.maxRetries) {
        await wait(config.mongo.retryDelayMS * attempt);
      }
    }
  }
  throw lastError;
};

const disconnectDB = async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
};

module.exports = { connectDB, disconnectDB };

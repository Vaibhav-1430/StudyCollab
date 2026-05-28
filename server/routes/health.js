const express = require('express');
const mongoose = require('mongoose');
const config = require('../config/env');

const router = express.Router();
const startedAt = Date.now();

const stateName = () => mongoose.connection.readyState;

router.get('/healthz', (req, res) => {
  const dbState = stateName();
  const healthy = dbState === 1;
  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    uptimeSec: Math.round(process.uptime()),
    environment: config.nodeEnv,
    startedAt: new Date(startedAt).toISOString(),
    database: {
      readyState: dbState,
      host: mongoose.connection.host || null,
      name: mongoose.connection.name || null
    }
  });
});

router.get('/readyz', (req, res) => {
  const ready = stateName() === 1;
  res.status(ready ? 200 : 503).json({ ready });
});

module.exports = router;

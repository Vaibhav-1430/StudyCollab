const express = require('express');
const config = require('../config/env');

const router = express.Router();

router.get('/webrtc', (req, res) => {
  const iceServers = config.webrtc.stunUrls.map((url) => ({ urls: url }));

  if (
    config.webrtc.turnUrls.length &&
    config.webrtc.turnUsername &&
    config.webrtc.turnCredential
  ) {
    iceServers.push({
      urls: config.webrtc.turnUrls,
      username: config.webrtc.turnUsername,
      credential: config.webrtc.turnCredential
    });
  }

  res.setHeader('Cache-Control', 'no-store');
  return res.json({ iceServers });
});

module.exports = router;

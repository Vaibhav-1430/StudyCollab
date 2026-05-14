const express = require('express');
const auth = require('../middleware/auth');
const { saveSession, getLatest } = require('../controllers/whiteboardController');

const router = express.Router();

router.get('/:code/latest', auth, getLatest);
router.post('/:code/save', auth, saveSession);

module.exports = router;

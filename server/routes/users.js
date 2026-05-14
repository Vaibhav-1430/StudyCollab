const express = require('express');
const multer = require('multer');
const { body } = require('express-validator');
const auth = require('../middleware/auth');
const validate = require('../middleware/validate');
const {
	getMe,
	searchUsers,
	updateMe,
	uploadAvatar
} = require('../controllers/userController');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

router.get('/me', auth, getMe);
router.put(
	'/me',
	auth,
	[body('name').isLength({ min: 2, max: 60 })],
	validate,
	updateMe
);
router.post('/avatar', auth, upload.single('avatar'), uploadAvatar);
router.get('/search', auth, searchUsers);

module.exports = router;

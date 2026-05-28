const express = require('express');
const multer = require('multer');
const auth = require('../middleware/auth');
const config = require('../config/env');
const {
	uploadFile,
	listRoomFiles,
	downloadFile,
	listUserFiles,
	deleteFile
} = require('../controllers/fileController');

const router = express.Router();

const maxSize = config.uploads.maxFileSizeMB * 1024 * 1024;
const allowedMimeTypes = new Set(config.uploads.allowedMimeTypes);

const upload = multer({
	storage: multer.memoryStorage(),
	limits: { fileSize: maxSize },
	fileFilter: (req, file, cb) => {
		if (!allowedMimeTypes.has(file.mimetype)) {
			const err = new Error('Unsupported file type');
			err.statusCode = 400;
			return cb(err);
		}
		return cb(null, true);
	}
});

router.post('/upload', auth, upload.single('file'), uploadFile);
router.get('/mine', auth, listUserFiles);
router.get('/room/:code', auth, listRoomFiles);
router.get('/:id/download', auth, downloadFile);
router.delete('/:id', auth, deleteFile);

module.exports = router;

const express = require('express');
const multer = require('multer');
const auth = require('../middleware/auth');
const {
	uploadFile,
	listRoomFiles,
	downloadFile,
	listUserFiles,
	deleteFile
} = require('../controllers/fileController');

const router = express.Router();

const maxSize = (parseInt(process.env.MAX_FILE_SIZE_MB, 10) || 20) * 1024 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: maxSize } });

router.post('/upload', auth, upload.single('file'), uploadFile);
router.get('/mine', auth, listUserFiles);
router.get('/room/:code', auth, listRoomFiles);
router.get('/:id/download', auth, downloadFile);
router.delete('/:id', auth, deleteFile);

module.exports = router;

const streamifier = require('streamifier');
const SavedFile = require('../models/SavedFile');
const Room = require('../models/Room');
const asyncHandler = require('../utils/asyncHandler');
const { sanitizeString } = require('../utils/sanitize');
const { initCloudinary } = require('../config/cloudinary');
const config = require('../config/env');
const logger = require('../utils/logger');

const cloudinary = initCloudinary();
const allowedMimeTypes = new Set(config.uploads.allowedMimeTypes);

const extensionByMime = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'application/pdf': '.pdf',
  'text/plain': '.txt',
  'text/markdown': '.md'
};

const isValidSignature = (file) => {
  const buffer = file.buffer || Buffer.alloc(0);
  const header = buffer.subarray(0, 12);
  if (file.mimetype === 'image/png') return header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (file.mimetype === 'image/jpeg') return header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
  if (file.mimetype === 'image/gif') return header.toString('ascii', 0, 6) === 'GIF87a' || header.toString('ascii', 0, 6) === 'GIF89a';
  if (file.mimetype === 'image/webp') return header.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
  if (file.mimetype === 'application/pdf') return header.toString('ascii', 0, 5) === '%PDF-';
  if (file.mimetype === 'text/plain' || file.mimetype === 'text/markdown') return !buffer.includes(0);
  return false;
};

const sanitizeFileName = (name, mimeType) => {
  const cleaned = sanitizeString(name || 'file')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140);
  const fallback = `file${extensionByMime[mimeType] || ''}`;
  return cleaned || fallback;
};

const uploadFile = asyncHandler(async (req, res) => {
  const { roomCode } = req.body;
  const file = req.file;

  if (!file) {
    return res.status(400).json({ message: 'No file uploaded' });
  }

  if (!allowedMimeTypes.has(file.mimetype)) {
    return res.status(400).json({ message: 'Unsupported file type' });
  }

  if (!isValidSignature(file)) {
    return res.status(400).json({ message: 'File content does not match its type' });
  }

  if (!roomCode) {
    return res.status(400).json({ message: 'Room code is required' });
  }

  const room = await Room.findOne({ code: sanitizeString(roomCode || '').toUpperCase() });
  if (!room) {
    return res.status(404).json({ message: 'Room not found' });
  }

  const allowed =
    room.isPublic ||
    String(room.owner) === String(req.user._id) ||
    room.members.some((member) => String(member) === String(req.user._id));

  if (!allowed) {
    return res.status(403).json({ message: 'Access denied' });
  }

  if (!cloudinary) {
    return res.status(500).json({ message: 'File storage is not configured' });
  }

  const folder = config.cloudinary.folder;
  let uploadResult;

  uploadResult = await new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: 'auto',
        use_filename: true,
        unique_filename: true
      },
      (error, result) => {
        if (error) return reject(error);
        return resolve(result);
      }
    );

    streamifier.createReadStream(file.buffer).pipe(uploadStream);
  });

  const safeName = sanitizeFileName(file.originalname, file.mimetype);

  let saved;
  try {
    saved = await SavedFile.create({
      room: room._id,
      uploader: req.user._id,
      originalName: safeName,
      storedName: uploadResult.public_id,
      mimeType: file.mimetype,
      size: file.size,
      url: uploadResult.secure_url,
      cloudinaryId: uploadResult.public_id,
      resourceType: uploadResult.resource_type
    });
  } catch (err) {
    if (cloudinary && uploadResult?.public_id) {
      await cloudinary.uploader.destroy(uploadResult.public_id, {
        resource_type: uploadResult.resource_type || 'raw'
      }).catch((cleanupErr) => {
        logger.warn('cloudinary_duplicate_cleanup_failed', { error: cleanupErr.message });
      });
    }
    throw err;
  }

  return res.status(201).json({
    file: {
      id: saved._id,
      name: saved.originalName,
      originalName: saved.originalName,
      mimeType: saved.mimeType,
      size: saved.size,
      url: `/api/files/${saved._id}/download`
    }
  });
});

const listRoomFiles = asyncHandler(async (req, res) => {
  const code = sanitizeString(req.params.code || '').toUpperCase();
  const room = await Room.findOne({ code });
  if (!room) {
    return res.status(404).json({ message: 'Room not found' });
  }

  const allowed =
    room.isPublic ||
    String(room.owner) === String(req.user._id) ||
    room.members.some((member) => String(member) === String(req.user._id));

  if (!allowed) {
    return res.status(403).json({ message: 'Access denied' });
  }

  const files = await SavedFile.find({ room: room._id }).sort({ createdAt: -1 });

  return res.json({ files });
});

const downloadFile = asyncHandler(async (req, res) => {
  const file = await SavedFile.findById(req.params.id);
  if (!file) {
    return res.status(404).json({ message: 'File not found' });
  }

  const room = await Room.findById(file.room);
  if (!room) {
    return res.status(404).json({ message: 'Room not found' });
  }

  const allowed =
    room.isPublic ||
    String(room.owner) === String(req.user._id) ||
    room.members.some((member) => String(member) === String(req.user._id));

  if (!allowed) {
    return res.status(403).json({ message: 'Access denied' });
  }

  return res.redirect(file.url);
});

const listUserFiles = asyncHandler(async (req, res) => {
  const files = await SavedFile.find({ uploader: req.user._id })
    .populate('room', 'name code')
    .sort({ createdAt: -1 });

  return res.json({ files });
});

const deleteFile = asyncHandler(async (req, res) => {
  const file = await SavedFile.findById(req.params.id);
  if (!file) {
    return res.status(404).json({ message: 'File not found' });
  }

  const room = await Room.findById(file.room);
  const allowed =
    room.isPublic ||
    String(room.owner) === String(req.user._id) ||
    room.members.some((member) => String(member) === String(req.user._id));

  if (!allowed) {
    return res.status(403).json({ message: 'Access denied' });
  }

  if (cloudinary && file.cloudinaryId) {
    try {
      await cloudinary.uploader.destroy(file.cloudinaryId, {
        resource_type: file.resourceType || 'raw'
      });
    } catch (err) {
      // Ignore cloud deletion errors to avoid blocking cleanup
    }
  }

  await file.deleteOne();
  return res.json({ message: 'File deleted' });
});

module.exports = { uploadFile, listRoomFiles, downloadFile, listUserFiles, deleteFile };

const streamifier = require('streamifier');
const SavedFile = require('../models/SavedFile');
const Room = require('../models/Room');
const asyncHandler = require('../utils/asyncHandler');
const { sanitizeString } = require('../utils/sanitize');
const { initCloudinary } = require('../config/cloudinary');

const cloudinary = initCloudinary();

const uploadFile = asyncHandler(async (req, res) => {
  const { roomCode } = req.body;
  const file = req.file;

  if (!file) {
    return res.status(400).json({ message: 'No file uploaded' });
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

  const folder = process.env.CLOUDINARY_FOLDER || 'study-collab';

  const uploadResult = await new Promise((resolve, reject) => {
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

  const saved = await SavedFile.create({
    room: room._id,
    uploader: req.user._id,
    originalName: file.originalname,
    storedName: uploadResult.public_id,
    mimeType: file.mimetype,
    size: file.size,
    url: uploadResult.secure_url,
    cloudinaryId: uploadResult.public_id,
    resourceType: uploadResult.resource_type
  });

  return res.status(201).json({
    file: {
      id: saved._id,
      name: saved.originalName,
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

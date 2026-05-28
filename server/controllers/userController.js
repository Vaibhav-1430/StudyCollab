const streamifier = require('streamifier');
const User = require('../models/User');
const asyncHandler = require('../utils/asyncHandler');
const { sanitizeString } = require('../utils/sanitize');
const { initCloudinary } = require('../config/cloudinary');
const config = require('../config/env');

const cloudinary = initCloudinary();

const serializeUser = (user) => ({
  id: user._id,
  name: user.name,
  email: user.email,
  avatar: user.avatar,
  status: user.status
});

const getMe = asyncHandler(async (req, res) => {
  return res.json({ user: serializeUser(req.user) });
});

const updateMe = asyncHandler(async (req, res) => {
  const name = sanitizeString(req.body.name || '');

  if (name.length < 2 || name.length > 60) {
    return res.status(400).json({ message: 'Name must be 2-60 characters' });
  }

  const user = await User.findByIdAndUpdate(
    req.user._id,
    { name },
    { new: true }
  );

  return res.json({ user: serializeUser(user) });
});

const uploadAvatar = asyncHandler(async (req, res) => {
  const file = req.file;
  if (!file) {
    return res.status(400).json({ message: 'No avatar uploaded' });
  }

  if (!cloudinary) {
    return res.status(503).json({ message: 'Avatar storage is not configured' });
  }

  const folder = config.cloudinary.folder;

  const uploadResult = await new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: `${folder}/avatars`,
        resource_type: 'image',
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

  const user = await User.findByIdAndUpdate(
    req.user._id,
    { avatar: uploadResult.secure_url },
    { new: true }
  );

  return res.json({ user: serializeUser(user) });
});

const searchUsers = asyncHandler(async (req, res) => {
  const query = sanitizeString(req.query.q || '');
  if (query.length < 2) {
    return res.json({ users: [] });
  }

  const regex = new RegExp(query, 'i');
  const users = await User.find({
    _id: { $ne: req.user._id },
    $or: [{ name: regex }, { email: regex }]
  })
    .select('name email avatar status')
    .limit(20);

  return res.json({ users });
});

module.exports = { getMe, searchUsers, updateMe, uploadAvatar };

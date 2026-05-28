const Room = require('../models/Room');
const User = require('../models/User');
const asyncHandler = require('../utils/asyncHandler');
const { sanitizeObject, sanitizeString } = require('../utils/sanitize');
const { generateRoomCode } = require('../utils/roomCode');
const store = require('../socket/store');

const createRoom = asyncHandler(async (req, res) => {
  const { name } = sanitizeObject(req.body, ['name']);
  const isPublic = Boolean(req.body.isPublic);

  if (!name) {
    return res.status(400).json({ message: 'Room name is required' });
  }

  let room = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateRoomCode();
    try {
      room = await Room.create({
        name,
        code,
        owner: req.user._id,
        isPublic,
        members: [req.user._id]
      });
      break;
    } catch (err) {
      if (err.code !== 11000) {
        throw err;
      }
    }
  }

  if (!room) {
    return res.status(500).json({ message: 'Failed to generate room code' });
  }

  return res.status(201).json({ room });
});

const joinRoom = asyncHandler(async (req, res) => {
  const { code: raw } = sanitizeObject(req.body, ['code']);
  const code = raw ? raw.toUpperCase() : '';
  if (!code) {
    return res.status(400).json({ message: 'Room code is required' });
  }
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

  if (!room.members.some((member) => String(member) === String(req.user._id))) {
    room.members.push(req.user._id);
    await room.save();
  }

  return res.json({ room });
});

const studyWithFriend = asyncHandler(async (req, res) => {
  const { friendId } = req.body || {};
  if (!friendId || String(friendId) === String(req.user._id)) {
    return res.status(400).json({ message: 'Invalid friend' });
  }

  if (!req.user.friends?.some((id) => String(id) === String(friendId))) {
    return res.status(403).json({ message: 'You can only start a session with friends on your list' });
  }

  const friend = await User.findById(friendId).select('name');
  if (!friend) {
    return res.status(404).json({ message: 'Friend not found' });
  }

  const rawName = `Study · ${req.user.name} & ${friend.name}`;
  const name = rawName.length > 80 ? `${rawName.slice(0, 77)}...` : rawName;

  let room = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateRoomCode();
    try {
      room = await Room.create({
        name,
        code,
        owner: req.user._id,
        isPublic: false,
        members: [req.user._id, friendId]
      });
      break;
    } catch (err) {
      if (err.code !== 11000) {
        throw err;
      }
    }
  }

  if (!room) {
    return res.status(500).json({ message: 'Failed to generate room code' });
  }

  const io = req.app.get('io');
  const socketId = store.getSocketId(friendId);
  if (io && socketId) {
    io.to(socketId).emit('notify:room-invite', {
      roomCode: room.code,
      roomName: room.name,
      from: {
        id: req.user._id,
        name: req.user.name,
        avatar: req.user.avatar
      }
    });
  }

  return res.status(201).json({ room });
});

const listRooms = asyncHandler(async (req, res) => {
  const rooms = await Room.find({
    $or: [{ owner: req.user._id }, { members: req.user._id }]
  }).sort({ updatedAt: -1 });

  return res.json({ rooms });
});

const getRoom = asyncHandler(async (req, res) => {
  const code = sanitizeString(req.params.code || '').toUpperCase();
  const room = await Room.findOne({ code }).populate(
    'members',
    'name avatar status'
  );

  if (!room) {
    return res.status(404).json({ message: 'Room not found' });
  }

  const allowed =
    room.isPublic ||
    String(room.owner) === String(req.user._id) ||
    room.members.some((member) => String(member._id) === String(req.user._id));

  if (!allowed) {
    return res.status(403).json({ message: 'Access denied' });
  }

  return res.json({ room });
});

const inviteUser = asyncHandler(async (req, res) => {
  const { userId } = req.body;
  const code = sanitizeString(req.params.code || '').toUpperCase();
  const room = await Room.findOne({ code });

  if (!room) {
    return res.status(404).json({ message: 'Room not found' });
  }

  if (String(room.owner) !== String(req.user._id)) {
    return res.status(403).json({ message: 'Only owner can invite' });
  }

  const targetUser = await User.findById(userId);
  if (!targetUser) {
    return res.status(404).json({ message: 'User not found' });
  }

  if (!room.members.some((member) => String(member) === String(userId))) {
    room.members.push(userId);
    await room.save();
  }

  const io = req.app.get('io');
  const socketId = require('../socket/store').getSocketId(userId);
  if (io && socketId) {
    io.to(socketId).emit('notify:room-invite', {
      roomCode: room.code,
      roomName: room.name,
      from: {
        id: req.user._id,
        name: req.user.name,
        avatar: req.user.avatar
      }
    });
  }

  return res.json({ success: true });
});

const addNote = asyncHandler(async (req, res) => {
  const content = sanitizeString(req.body.content || '');
  if (!content) {
    return res.status(400).json({ message: 'Note content is required' });
  }

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

  room.notes.push({ content, createdBy: req.user._id });
  await room.save();

  return res.status(201).json({ success: true });
});

const listNotes = asyncHandler(async (req, res) => {
  const code = sanitizeString(req.params.code || '').toUpperCase();
  const room = await Room.findOne({ code }).populate(
    'notes.createdBy',
    'name avatar'
  );

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

  return res.json({ notes: room.notes || [] });
});

module.exports = {
  createRoom,
  joinRoom,
  studyWithFriend,
  listRooms,
  getRoom,
  inviteUser,
  addNote,
  listNotes
};

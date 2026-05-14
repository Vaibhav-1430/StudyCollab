const Room = require('../models/Room');
const WhiteboardSession = require('../models/WhiteboardSession');
const asyncHandler = require('../utils/asyncHandler');
const { sanitizeString } = require('../utils/sanitize');

const saveSession = asyncHandler(async (req, res) => {
  const { events } = req.body;
  if (!Array.isArray(events)) {
    return res.status(400).json({ message: 'Invalid events payload' });
  }
  if (events.length > 5000) {
    return res.status(400).json({ message: 'Too many events to save' });
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

  const session = await WhiteboardSession.create({
    room: room._id,
    savedBy: req.user._id,
    events
  });

  return res.status(201).json({ sessionId: session._id });
});

const getLatest = asyncHandler(async (req, res) => {
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

  const session = await WhiteboardSession.findOne({ room: room._id }).sort({
    createdAt: -1
  });

  return res.json({ events: session ? session.events : [] });
});

module.exports = { saveSession, getLatest };

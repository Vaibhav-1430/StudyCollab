const FriendRequest = require('../models/FriendRequest');
const User = require('../models/User');
const asyncHandler = require('../utils/asyncHandler');
const store = require('../socket/store');

const sendRequest = asyncHandler(async (req, res) => {
  const { toUserId } = req.body;

  if (!toUserId || String(toUserId) === String(req.user._id)) {
    return res.status(400).json({ message: 'Invalid user' });
  }

  const existingFriend = await User.findOne({
    _id: req.user._id,
    friends: toUserId
  });
  if (existingFriend) {
    return res.status(400).json({ message: 'Already friends' });
  }

  const targetUser = await User.findById(toUserId);
  if (!targetUser) {
    return res.status(404).json({ message: 'User not found' });
  }

  const existingRequest = await FriendRequest.findOne({
    from: req.user._id,
    to: toUserId,
    status: 'pending'
  });
  if (existingRequest) {
    return res.status(400).json({ message: 'Request already sent' });
  }

  const request = await FriendRequest.create({
    from: req.user._id,
    to: toUserId
  });

  const io = req.app.get('io');
  const socketId = store.getSocketId(toUserId);
  if (io && socketId) {
    io.to(socketId).emit('notify:friend-request', {
      requestId: request._id,
      from: {
        id: req.user._id,
        name: req.user.name,
        avatar: req.user.avatar
      }
    });
  }

  return res.status(201).json({ requestId: request._id });
});

const acceptRequest = asyncHandler(async (req, res) => {
  const { requestId } = req.body;

  const request = await FriendRequest.findOne({
    _id: requestId,
    to: req.user._id,
    status: 'pending'
  });

  if (!request) {
    return res.status(404).json({ message: 'Request not found' });
  }

  request.status = 'accepted';
  await request.save();

  await User.updateOne(
    { _id: req.user._id },
    { $addToSet: { friends: request.from } }
  );
  await User.updateOne(
    { _id: request.from },
    { $addToSet: { friends: req.user._id } }
  );

  return res.json({ success: true });
});

const rejectRequest = asyncHandler(async (req, res) => {
  const { requestId } = req.body;

  const request = await FriendRequest.findOne({
    _id: requestId,
    to: req.user._id,
    status: 'pending'
  });

  if (!request) {
    return res.status(404).json({ message: 'Request not found' });
  }

  request.status = 'rejected';
  await request.save();

  return res.json({ success: true });
});

const listFriends = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).populate(
    'friends',
    'name email avatar status'
  );
  return res.json({ friends: user.friends || [] });
});

const listRequests = asyncHandler(async (req, res) => {
  const requests = await FriendRequest.find({
    to: req.user._id,
    status: 'pending'
  }).populate('from', 'name avatar status');

  return res.json({ requests });
});

module.exports = {
  sendRequest,
  acceptRequest,
  rejectRequest,
  listFriends,
  listRequests
};

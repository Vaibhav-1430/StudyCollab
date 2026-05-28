const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const asyncHandler = require('../utils/asyncHandler');
const { sanitizeObject } = require('../utils/sanitize');
const config = require('../config/env');

const signToken = (id) =>
  jwt.sign({ id }, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn
  });

const buildUser = (user) => ({
  id: user._id,
  name: user.name,
  email: user.email,
  avatar: user.avatar,
  status: user.status
});

const register = asyncHandler(async (req, res) => {
  const { name, email } = sanitizeObject(req.body, ['name', 'email']);
  const password = req.body.password;

  if (!name || !email || !password) {
    return res.status(400).json({ message: 'Missing required fields' });
  }

  const existing = await User.findOne({ email });
  if (existing) {
    return res.status(409).json({ message: 'Email already in use' });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await User.create({ name, email, passwordHash, status: 'online' });
  user.lastSeen = new Date();
  await user.save();
  const token = signToken(user._id);

  return res.status(201).json({ token, user: buildUser(user) });
});

const login = asyncHandler(async (req, res) => {
  const { email } = sanitizeObject(req.body, ['email']);
  const password = req.body.password;

  if (!email || !password) {
    return res.status(400).json({ message: 'Missing credentials' });
  }

  const user = await User.findOne({ email }).select('+passwordHash');
  if (!user) {
    return res.status(401).json({ message: 'Invalid credentials' });
  }

  const match = await bcrypt.compare(password, user.passwordHash);
  if (!match) {
    return res.status(401).json({ message: 'Invalid credentials' });
  }

  user.status = 'online';
  user.lastSeen = new Date();
  await user.save();

  const token = signToken(user._id);
  return res.json({ token, user: buildUser(user) });
});

const demoLogin = asyncHandler(async (req, res) => {
  const email = 'demo@studycollab.app';
  const name = 'Demo Student';

  let user = await User.findOne({ email });
  if (!user) {
    const passwordHash = await bcrypt.hash(
      `demo-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      12
    );
    user = await User.create({ name, email, passwordHash, status: 'online' });
  }

  user.status = 'online';
  user.lastSeen = new Date();
  await user.save();

  const token = signToken(user._id);
  return res.json({ token, user: buildUser(user) });
});

const me = asyncHandler(async (req, res) => {
  return res.json({ user: buildUser(req.user) });
});

const logout = asyncHandler(async (req, res) => {
  await User.updateOne(
    { _id: req.user._id },
    { status: 'offline', lastSeen: new Date() }
  );
  return res.json({ success: true });
});

module.exports = { register, login, demoLogin, me, logout };

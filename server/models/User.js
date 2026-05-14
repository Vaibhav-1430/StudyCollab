const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 60 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    avatar: { type: String, default: '' },
    status: { type: String, enum: ['online', 'offline'], default: 'offline' },
    friends: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    lastSeen: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

module.exports = mongoose.model('User', userSchema);

const mongoose = require('mongoose');

const savedFileSchema = new mongoose.Schema(
  {
    room: { type: mongoose.Schema.Types.ObjectId, ref: 'Room', required: true },
    uploader: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    originalName: { type: String, required: true },
    storedName: { type: String },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
    url: { type: String, required: true },
    cloudinaryId: { type: String },
    resourceType: { type: String, default: 'raw' }
  },
  { timestamps: true }
);

module.exports = mongoose.model('SavedFile', savedFileSchema);

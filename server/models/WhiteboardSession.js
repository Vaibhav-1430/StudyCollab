const mongoose = require('mongoose');

const whiteboardSessionSchema = new mongoose.Schema(
  {
    room: { type: mongoose.Schema.Types.ObjectId, ref: 'Room', required: true },
    savedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    events: { type: [mongoose.Schema.Types.Mixed], default: [] }
  },
  { timestamps: true }
);

module.exports = mongoose.model('WhiteboardSession', whiteboardSessionSchema);

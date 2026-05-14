const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Room = require('../models/Room');
const Message = require('../models/Message');
const WhiteboardSession = require('../models/WhiteboardSession');
const { sanitizeString } = require('../utils/sanitize');
const store = require('./store');

const roomState = new Map();
const MAX_EVENTS = 5000;

const getRoomState = (code) => {
  if (!roomState.has(code)) {
    roomState.set(code, {
      members: new Map(),
      events: [],
      redo: [],
      annotations: new Map(),
      screenPresenter: null
    });
  }
  return roomState.get(code);
};

const trimEvents = (state) => {
  if (state.events.length > MAX_EVENTS) {
    state.events = state.events.slice(-MAX_EVENTS);
  }
};

const getAnnotationState = (state, target) => {
  if (!state.annotations) {
    state.annotations = new Map();
  }
  if (!state.annotations.has(target)) {
    state.annotations.set(target, { events: [], redo: [] });
  }
  return state.annotations.get(target);
};

const trimAnnotationEvents = (state) => {
  if (state.events.length > MAX_EVENTS) {
    state.events = state.events.slice(-MAX_EVENTS);
  }
};

const safeRoomCode = (raw) => sanitizeString(raw || '').toUpperCase();

const canAccessRoom = (room, userId) => {
  if (!room) return false;
  if (room.isPublic) return true;
  if (String(room.owner) === String(userId)) return true;
  return room.members.some((member) => String(member) === String(userId));
};

const socketInRoom = (socket, code) => socket.rooms.has(code);

module.exports = (io) => {
  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) {
      return next(new Error('Unauthorized'));
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id).select('name avatar status');
      if (!user) {
        return next(new Error('Unauthorized'));
      }

      socket.user = {
        id: String(user._id),
        name: user.name,
        avatar: user.avatar,
        status: 'online'
      };

      await User.updateOne(
        { _id: user._id },
        { status: 'online', lastSeen: new Date() }
      );

      return next();
    } catch (err) {
      return next(new Error('Unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const user = socket.user;
    store.setUserSocket(user.id, socket.id);

    socket.on('room:join', async ({ code }) => {
      const safeCode = safeRoomCode(code);
      const room = await Room.findOne({ code: safeCode });

      if (!room) {
        return socket.emit('room:error', { message: 'Room not found' });
      }

      if (!canAccessRoom(room, user.id)) {
        return socket.emit('room:error', { message: 'Access denied' });
      }

      socket.join(safeCode);
      const state = getRoomState(safeCode);

      if (!state.events.length) {
        const latest = await WhiteboardSession.findOne({ room: room._id })
          .sort({ createdAt: -1 })
          .lean();
        if (latest?.events?.length) {
          state.events = [...latest.events];
          state.redo = [];
        }
      }

      const member = { ...user, socketId: socket.id };
      state.members.set(socket.id, member);

      io.to(safeCode).emit('room:users', {
        users: Array.from(state.members.values())
      });

      socket.emit('board:sync-data', { events: state.events });
      socket.emit('screen:share:state', {
        presenter: state.screenPresenter
      });

      const messages = await Message.find({ room: room._id })
        .sort({ createdAt: -1 })
        .limit(50)
        .populate('sender', 'name avatar');

      socket.emit('chat:history', { messages: messages.reverse() });
      socket.to(safeCode).emit('room:user-joined', { user: member });
      return undefined;
    });

    socket.on('room:leave', ({ code }) => {
      const safeCode = safeRoomCode(code);
      socket.leave(safeCode);
      const state = roomState.get(safeCode);
      if (state) {
        state.members.delete(socket.id);
        if (state.screenPresenter?.socketId === socket.id) {
          state.screenPresenter = null;
          io.to(safeCode).emit('screen:share:stopped', { socketId: socket.id });
        }
        if (state.members.size === 0) {
          roomState.delete(safeCode);
        } else {
          io.to(safeCode).emit('room:users', {
            users: Array.from(state.members.values())
          });
          socket.to(safeCode).emit('room:user-left', {
            userId: user.id,
            socketId: socket.id
          });
        }
      }
    });

    socket.on('cursor:move', ({ code, x, y }) => {
      const safeCode = safeRoomCode(code);
      if (!socketInRoom(socket, safeCode)) return;
      socket.to(safeCode).emit('cursor:move', {
        userId: user.id,
        x,
        y
      });
    });

    socket.on('board:stroke:start', ({ code, stroke }) => {
      const safeCode = safeRoomCode(code);
      if (!socketInRoom(socket, safeCode)) return;
      const state = getRoomState(safeCode);
      state.events.push({
        type: 'stroke',
        id: stroke.id,
        color: stroke.color,
        size: stroke.size,
        mode: stroke.mode,
        points: [stroke.point]
      });
      trimEvents(state);
      state.redo = [];
      socket.to(safeCode).emit('board:stroke:start', { stroke });
    });

    socket.on('board:stroke:point', ({ code, strokeId, point }) => {
      const safeCode = safeRoomCode(code);
      if (!socketInRoom(socket, safeCode)) return;
      const state = getRoomState(safeCode);
      const event = state.events.find(
        (entry) => entry.type === 'stroke' && entry.id === strokeId
      );
      if (event) {
        event.points.push(point);
      }
      socket.to(safeCode).emit('board:stroke:point', { strokeId, point });
    });

    socket.on('board:stroke:end', ({ code, strokeId }) => {
      const safeCode = safeRoomCode(code);
      if (!socketInRoom(socket, safeCode)) return;
      socket.to(safeCode).emit('board:stroke:end', { strokeId });
    });

    socket.on('board:shape:add', ({ code, shape }) => {
      const safeCode = safeRoomCode(code);
      if (!socketInRoom(socket, safeCode)) return;
      const state = getRoomState(safeCode);
      state.events.push({ type: 'shape', ...shape });
      trimEvents(state);
      state.redo = [];
      socket.to(safeCode).emit('board:shape:add', { shape });
    });

    socket.on('board:text:add', ({ code, text }) => {
      const safeCode = safeRoomCode(code);
      if (!socketInRoom(socket, safeCode)) return;
      const state = getRoomState(safeCode);
      state.events.push({ type: 'text', ...text });
      trimEvents(state);
      state.redo = [];
      socket.to(safeCode).emit('board:text:add', { text });
    });

    socket.on('board:sticky:add', ({ code, sticky }) => {
      const safeCode = safeRoomCode(code);
      if (!socketInRoom(socket, safeCode)) return;
      const state = getRoomState(safeCode);
      state.events.push({ type: 'sticky', ...sticky });
      trimEvents(state);
      state.redo = [];
      socket.to(safeCode).emit('board:sticky:add', { sticky });
    });

    socket.on('board:clear', ({ code }) => {
      const safeCode = safeRoomCode(code);
      if (!socketInRoom(socket, safeCode)) return;
      const state = getRoomState(safeCode);
      state.events.push({ type: 'clear', id: Date.now() });
      trimEvents(state);
      state.redo = [];
      io.to(safeCode).emit('board:clear');
    });

    socket.on('board:undo', ({ code }) => {
      const safeCode = safeRoomCode(code);
      if (!socketInRoom(socket, safeCode)) return;
      const state = getRoomState(safeCode);
      const last = state.events.pop();
      if (last) {
        state.redo.push(last);
      }
      io.to(safeCode).emit('board:sync-data', { events: state.events });
    });

    socket.on('board:redo', ({ code }) => {
      const safeCode = safeRoomCode(code);
      if (!socketInRoom(socket, safeCode)) return;
      const state = getRoomState(safeCode);
      const redo = state.redo.pop();
      if (redo) {
        state.events.push(redo);
      }
      io.to(safeCode).emit('board:sync-data', { events: state.events });
    });

    socket.on('board:sync-request', ({ code }) => {
      const safeCode = safeRoomCode(code);
      if (!socketInRoom(socket, safeCode)) return;
      const state = getRoomState(safeCode);
      socket.emit('board:sync-data', { events: state.events });
    });

    socket.on('annot:stroke:start', ({ code, target, stroke }) => {
      const safeCode = safeRoomCode(code);
      if (!socketInRoom(socket, safeCode)) return;
      const state = getRoomState(safeCode);
      const channel = getAnnotationState(state, target);
      channel.events.push({
        type: 'stroke',
        id: stroke.id,
        color: stroke.color,
        size: stroke.size,
        mode: stroke.mode,
        points: [stroke.point]
      });
      trimAnnotationEvents(channel);
      channel.redo = [];
      socket.to(safeCode).emit('annot:stroke:start', { target, stroke });
    });

    socket.on('annot:stroke:point', ({ code, target, strokeId, point }) => {
      const safeCode = safeRoomCode(code);
      if (!socketInRoom(socket, safeCode)) return;
      const state = getRoomState(safeCode);
      const channel = getAnnotationState(state, target);
      const event = channel.events.find(
        (entry) => entry.type === 'stroke' && entry.id === strokeId
      );
      if (event) {
        event.points.push(point);
      }
      socket.to(safeCode).emit('annot:stroke:point', { target, strokeId, point });
    });

    socket.on('annot:stroke:end', ({ code, target, strokeId }) => {
      const safeCode = safeRoomCode(code);
      if (!socketInRoom(socket, safeCode)) return;
      socket.to(safeCode).emit('annot:stroke:end', { target, strokeId });
    });

    socket.on('annot:shape:add', ({ code, target, shape }) => {
      const safeCode = safeRoomCode(code);
      if (!socketInRoom(socket, safeCode)) return;
      const state = getRoomState(safeCode);
      const channel = getAnnotationState(state, target);
      channel.events.push({ type: 'shape', ...shape });
      trimAnnotationEvents(channel);
      channel.redo = [];
      socket.to(safeCode).emit('annot:shape:add', { target, shape });
    });

    socket.on('annot:text:add', ({ code, target, text }) => {
      const safeCode = safeRoomCode(code);
      if (!socketInRoom(socket, safeCode)) return;
      const state = getRoomState(safeCode);
      const channel = getAnnotationState(state, target);
      channel.events.push({ type: 'text', ...text });
      trimAnnotationEvents(channel);
      channel.redo = [];
      socket.to(safeCode).emit('annot:text:add', { target, text });
    });

    socket.on('annot:clear', ({ code, target }) => {
      const safeCode = safeRoomCode(code);
      if (!socketInRoom(socket, safeCode)) return;
      const state = getRoomState(safeCode);
      const channel = getAnnotationState(state, target);
      channel.events.push({ type: 'clear', id: Date.now() });
      trimAnnotationEvents(channel);
      channel.redo = [];
      io.to(safeCode).emit('annot:clear', { target });
    });

    socket.on('annot:undo', ({ code, target }) => {
      const safeCode = safeRoomCode(code);
      if (!socketInRoom(socket, safeCode)) return;
      const state = getRoomState(safeCode);
      const channel = getAnnotationState(state, target);
      const last = channel.events.pop();
      if (last) {
        channel.redo.push(last);
      }
      io.to(safeCode).emit('annot:sync-data', { target, events: channel.events });
    });

    socket.on('annot:redo', ({ code, target }) => {
      const safeCode = safeRoomCode(code);
      if (!socketInRoom(socket, safeCode)) return;
      const state = getRoomState(safeCode);
      const channel = getAnnotationState(state, target);
      const redo = channel.redo.pop();
      if (redo) {
        channel.events.push(redo);
      }
      io.to(safeCode).emit('annot:sync-data', { target, events: channel.events });
    });

    socket.on('annot:sync-request', ({ code, target }) => {
      const safeCode = safeRoomCode(code);
      if (!socketInRoom(socket, safeCode)) return;
      const state = getRoomState(safeCode);
      const channel = getAnnotationState(state, target);
      socket.emit('annot:sync-data', { target, events: channel.events });
    });

    socket.on('screen:share:started', ({ code }) => {
      const safeCode = safeRoomCode(code);
      if (!socketInRoom(socket, safeCode)) return;
      const state = getRoomState(safeCode);
      const presenter = {
        userId: user.id,
        name: user.name,
        socketId: socket.id
      };
      state.screenPresenter = presenter;
      io.to(safeCode).emit('screen:share:started', { presenter });
    });

    socket.on('screen:share:stopped', ({ code }) => {
      const safeCode = safeRoomCode(code);
      if (!socketInRoom(socket, safeCode)) return;
      const state = getRoomState(safeCode);
      if (state.screenPresenter?.socketId === socket.id) {
        state.screenPresenter = null;
      }
      io.to(safeCode).emit('screen:share:stopped', { socketId: socket.id });
    });

    socket.on('files:uploaded', ({ code }) => {
      const safeCode = safeRoomCode(code);
      if (!socketInRoom(socket, safeCode)) return;
      io.to(safeCode).emit('files:uploaded');
    });

    socket.on('files:deleted', ({ code, fileId }) => {
      const safeCode = safeRoomCode(code);
      if (!socketInRoom(socket, safeCode)) return;
      io.to(safeCode).emit('files:deleted', { fileId });
    });

    const messageThrottle = { lastAt: 0 };

    socket.on('chat:message', async ({ code, content }) => {
      const now = Date.now();
      if (now - messageThrottle.lastAt < 600) {
        return;
      }
      messageThrottle.lastAt = now;

      const safeCode = safeRoomCode(code);
      if (!socketInRoom(socket, safeCode)) return;
      const messageText = sanitizeString(content);
      if (!messageText) {
        return;
      }

      const room = await Room.findOne({ code: safeCode });
      if (!room || !canAccessRoom(room, user.id)) {
        return;
      }

      const message = await Message.create({
        room: room._id,
        sender: user.id,
        content: messageText
      });

      io.to(safeCode).emit('chat:message', {
        id: message._id,
        content: messageText,
        sender: {
          id: user.id,
          name: user.name,
          avatar: user.avatar
        },
        createdAt: message.createdAt
      });
    });

    socket.on('chat:typing', ({ code, isTyping }) => {
      const safeCode = safeRoomCode(code);
      if (!socketInRoom(socket, safeCode)) return;
      socket.to(safeCode).emit('chat:typing', {
        userId: user.id,
        name: user.name,
        isTyping: Boolean(isTyping)
      });
    });

    socket.on('webrtc:offer', ({ targetId, sdp }) => {
      io.to(targetId).emit('webrtc:offer', {
        fromId: socket.id,
        sdp,
        user
      });
    });

    socket.on('webrtc:answer', ({ targetId, sdp }) => {
      io.to(targetId).emit('webrtc:answer', { fromId: socket.id, sdp });
    });

    socket.on('webrtc:candidate', ({ targetId, candidate }) => {
      io.to(targetId).emit('webrtc:candidate', {
        fromId: socket.id,
        candidate
      });
    });

    socket.on('disconnect', async () => {
      store.removeSocket(socket.id);

      for (const [code, state] of roomState.entries()) {
        if (state.members.has(socket.id)) {
          state.members.delete(socket.id);
          if (state.screenPresenter?.socketId === socket.id) {
            state.screenPresenter = null;
            io.to(code).emit('screen:share:stopped', { socketId: socket.id });
          }
          if (state.members.size === 0) {
            roomState.delete(code);
          } else {
            io.to(code).emit('room:users', {
              users: Array.from(state.members.values())
            });
            io.to(code).emit('room:user-left', {
              userId: user.id,
              socketId: socket.id
            });
          }
        }
      }

      await User.updateOne(
        { _id: user.id },
        { status: 'offline', lastSeen: new Date() }
      );
    });
  });
};

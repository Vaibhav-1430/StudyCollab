const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Room = require('../models/Room');
const Message = require('../models/Message');
const WhiteboardSession = require('../models/WhiteboardSession');
const { sanitizeString } = require('../utils/sanitize');
const store = require('./store');
const config = require('../config/env');
const logger = require('../utils/logger');

const roomState = new Map();
const MAX_EVENTS = 5000;
const MAX_POINTS_PER_BATCH = 80;
const ROOM_TTL_MS = 6 * 60 * 60 * 1000;

const getRoomState = (code) => {
  if (!roomState.has(code)) {
    roomState.set(code, {
      members: new Map(),
      events: [],
      redo: [],
      annotations: new Map(),
      screenPresenter: null,
      lastActiveAt: Date.now()
    });
  }
  const state = roomState.get(code);
  state.lastActiveAt = Date.now();
  return state;
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

const touchRoom = (code) => {
  const state = roomState.get(code);
  if (state) state.lastActiveAt = Date.now();
};

const safePoint = (point) => {
  if (!point || typeof point !== 'object') return null;
  const x = Number(point.x);
  const y = Number(point.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return {
    x: Math.max(0, Math.min(x, 5000)),
    y: Math.max(0, Math.min(y, 5000)),
    pressure: Number.isFinite(Number(point.pressure)) ? Number(point.pressure) : 0.5
  };
};

const safePoints = (points) =>
  (Array.isArray(points) ? points : [])
    .slice(0, MAX_POINTS_PER_BATCH)
    .map(safePoint)
    .filter(Boolean);

module.exports = (io) => {
  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) {
      return next(new Error('Unauthorized'));
    }

    try {
      const decoded = jwt.verify(token, config.jwt.secret);
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
    logger.info('socket_connected', { socketId: socket.id, userId: user.id });

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

      const member = { ...user, socketId: socket.id, isMuted: false };
      state.members.set(socket.id, member);

      io.to(safeCode).emit('room:users', {
        users: Array.from(state.members.values()).map((entry) => ({
          ...entry,
          isMuted: Boolean(entry.isMuted)
        }))
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
        touchRoom(safeCode);
        state.members.delete(socket.id);
        if (state.screenPresenter?.socketId === socket.id) {
          state.screenPresenter = null;
          io.to(safeCode).emit('screen:share:stopped', { socketId: socket.id });
        }
        if (state.members.size === 0) {
          roomState.delete(safeCode);
        } else {
          io.to(safeCode).emit('room:users', {
            users: Array.from(state.members.values()).map((entry) => ({
              ...entry,
              isMuted: Boolean(entry.isMuted)
            }))
          });
          socket.to(safeCode).emit('room:user-left', {
            userId: user.id,
            socketId: socket.id
          });
        }
      }
    });

    socket.on('audio:mute', ({ code, muted }) => {
      const safeCode = safeRoomCode(code);
      if (!socketInRoom(socket, safeCode)) return;
      const state = getRoomState(safeCode);
      const member = state.members.get(socket.id);
      if (member) {
        member.isMuted = Boolean(muted);
      }
      socket.to(safeCode).emit('audio:mute', {
        userId: user.id,
        socketId: socket.id,
        muted: Boolean(muted)
      });
    });

    socket.on('board:stroke:start', ({ code, stroke }) => {
      const safeCode = safeRoomCode(code);
      if (!socketInRoom(socket, safeCode)) return;
      const point = safePoint(stroke?.point);
      if (!point) return;
      const state = getRoomState(safeCode);
      state.events.push({
        type: 'stroke',
        id: stroke.id,
        color: stroke.color,
        size: stroke.size,
        mode: stroke.mode,
        points: [point]
      });
      trimEvents(state);
      state.redo = [];
      socket.to(safeCode).emit('board:stroke:start', { stroke: { ...stroke, point } });
    });

    socket.on('board:stroke:point', ({ code, strokeId, point }) => {
      const safeCode = safeRoomCode(code);
      if (!socketInRoom(socket, safeCode)) return;
      const cleanPoint = safePoint(point);
      if (!cleanPoint) return;
      const state = getRoomState(safeCode);
      const event = state.events.find(
        (entry) => entry.type === 'stroke' && entry.id === strokeId
      );
      if (event) {
        event.points.push(cleanPoint);
      }
      socket.to(safeCode).emit('board:stroke:point', { strokeId, point: cleanPoint });
    });

    socket.on('board:stroke:points', ({ code, strokeId, points }) => {
      const safeCode = safeRoomCode(code);
      if (!socketInRoom(socket, safeCode)) return;
      const cleanPoints = safePoints(points);
      if (!cleanPoints.length) return;
      const state = getRoomState(safeCode);
      const event = state.events.find(
        (entry) => entry.type === 'stroke' && entry.id === strokeId
      );
      if (event) {
        event.points.push(...cleanPoints);
      }
      socket.to(safeCode).emit('board:stroke:points', { strokeId, points: cleanPoints });
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
      const safeTarget = sanitizeString(target || 'screen').slice(0, 120);
      const point = safePoint(stroke?.point);
      if (!point) return;
      const state = getRoomState(safeCode);
      const channel = getAnnotationState(state, safeTarget);
      channel.events.push({
        type: 'stroke',
        id: stroke.id,
        color: stroke.color,
        size: stroke.size,
        mode: stroke.mode,
        points: [point]
      });
      trimAnnotationEvents(channel);
      channel.redo = [];
      socket.to(safeCode).emit('annot:stroke:start', {
        target: safeTarget,
        stroke: { ...stroke, point }
      });
    });

    socket.on('annot:stroke:point', ({ code, target, strokeId, point }) => {
      const safeCode = safeRoomCode(code);
      if (!socketInRoom(socket, safeCode)) return;
      const safeTarget = sanitizeString(target || 'screen').slice(0, 120);
      const cleanPoint = safePoint(point);
      if (!cleanPoint) return;
      const state = getRoomState(safeCode);
      const channel = getAnnotationState(state, safeTarget);
      const event = channel.events.find(
        (entry) => entry.type === 'stroke' && entry.id === strokeId
      );
      if (event) {
        event.points.push(cleanPoint);
      }
      socket.to(safeCode).emit('annot:stroke:point', {
        target: safeTarget,
        strokeId,
        point: cleanPoint
      });
    });

    socket.on('annot:stroke:points', ({ code, target, strokeId, points }) => {
      const safeCode = safeRoomCode(code);
      if (!socketInRoom(socket, safeCode)) return;
      const safeTarget = sanitizeString(target || 'screen').slice(0, 120);
      const cleanPoints = safePoints(points);
      if (!cleanPoints.length) return;
      const state = getRoomState(safeCode);
      const channel = getAnnotationState(state, safeTarget);
      const event = channel.events.find(
        (entry) => entry.type === 'stroke' && entry.id === strokeId
      );
      if (event) {
        event.points.push(...cleanPoints);
      }
      socket.to(safeCode).emit('annot:stroke:points', {
        target: safeTarget,
        strokeId,
        points: cleanPoints
      });
    });

    socket.on('annot:stroke:end', ({ code, target, strokeId }) => {
      const safeCode = safeRoomCode(code);
      if (!socketInRoom(socket, safeCode)) return;
      const safeTarget = sanitizeString(target || 'screen').slice(0, 120);
      socket.to(safeCode).emit('annot:stroke:end', { target: safeTarget, strokeId });
    });

    socket.on('annot:shape:add', ({ code, target, shape }) => {
      const safeCode = safeRoomCode(code);
      if (!socketInRoom(socket, safeCode)) return;
      const safeTarget = sanitizeString(target || 'screen').slice(0, 120);
      const state = getRoomState(safeCode);
      const channel = getAnnotationState(state, safeTarget);
      channel.events.push({ type: 'shape', ...shape });
      trimAnnotationEvents(channel);
      channel.redo = [];
      socket.to(safeCode).emit('annot:shape:add', { target: safeTarget, shape });
    });

    socket.on('annot:text:add', ({ code, target, text }) => {
      const safeCode = safeRoomCode(code);
      if (!socketInRoom(socket, safeCode)) return;
      const safeTarget = sanitizeString(target || 'screen').slice(0, 120);
      const state = getRoomState(safeCode);
      const channel = getAnnotationState(state, safeTarget);
      channel.events.push({ type: 'text', ...text });
      trimAnnotationEvents(channel);
      channel.redo = [];
      socket.to(safeCode).emit('annot:text:add', { target: safeTarget, text });
    });

    socket.on('annot:clear', ({ code, target }) => {
      const safeCode = safeRoomCode(code);
      if (!socketInRoom(socket, safeCode)) return;
      const safeTarget = sanitizeString(target || 'screen').slice(0, 120);
      const state = getRoomState(safeCode);
      const channel = getAnnotationState(state, safeTarget);
      channel.events.push({ type: 'clear', id: Date.now() });
      trimAnnotationEvents(channel);
      channel.redo = [];
      io.to(safeCode).emit('annot:clear', { target: safeTarget });
    });

    socket.on('annot:undo', ({ code, target }) => {
      const safeCode = safeRoomCode(code);
      if (!socketInRoom(socket, safeCode)) return;
      const safeTarget = sanitizeString(target || 'screen').slice(0, 120);
      const state = getRoomState(safeCode);
      const channel = getAnnotationState(state, safeTarget);
      const last = channel.events.pop();
      if (last) {
        channel.redo.push(last);
      }
      io.to(safeCode).emit('annot:sync-data', { target: safeTarget, events: channel.events });
    });

    socket.on('annot:redo', ({ code, target }) => {
      const safeCode = safeRoomCode(code);
      if (!socketInRoom(socket, safeCode)) return;
      const safeTarget = sanitizeString(target || 'screen').slice(0, 120);
      const state = getRoomState(safeCode);
      const channel = getAnnotationState(state, safeTarget);
      const redo = channel.redo.pop();
      if (redo) {
        channel.events.push(redo);
      }
      io.to(safeCode).emit('annot:sync-data', { target: safeTarget, events: channel.events });
    });

    socket.on('annot:sync-request', ({ code, target }) => {
      const safeCode = safeRoomCode(code);
      if (!socketInRoom(socket, safeCode)) return;
      const safeTarget = sanitizeString(target || 'screen').slice(0, 120);
      const state = getRoomState(safeCode);
      const channel = getAnnotationState(state, safeTarget);
      socket.emit('annot:sync-data', { target: safeTarget, events: channel.events });
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
      if (!targetId || !sdp?.type) return;
      io.to(targetId).emit('webrtc:offer', {
        fromId: socket.id,
        sdp,
        user
      });
    });

    socket.on('webrtc:answer', ({ targetId, sdp }) => {
      if (!targetId || !sdp?.type) return;
      io.to(targetId).emit('webrtc:answer', { fromId: socket.id, sdp });
    });

    socket.on('webrtc:candidate', ({ targetId, candidate }) => {
      if (!targetId || !candidate) return;
      io.to(targetId).emit('webrtc:candidate', {
        fromId: socket.id,
        candidate
      });
    });

    socket.on('disconnect', async () => {
      logger.info('socket_disconnected', { socketId: socket.id, userId: user.id });
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
              users: Array.from(state.members.values()).map((entry) => ({
                ...entry,
                isMuted: Boolean(entry.isMuted)
              }))
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

  setInterval(() => {
    const now = Date.now();
    for (const [code, state] of roomState.entries()) {
      if (state.members.size === 0 && now - state.lastActiveAt > ROOM_TTL_MS) {
        roomState.delete(code);
        logger.info('socket_room_pruned', { code });
      }
    }
  }, 15 * 60 * 1000).unref();
};

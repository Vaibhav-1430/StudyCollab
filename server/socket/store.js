const userToSocket = new Map();
const socketToUser = new Map();

const setUserSocket = (userId, socketId) => {
  const key = String(userId);
  userToSocket.set(key, socketId);
  socketToUser.set(socketId, key);
};

const getSocketId = (userId) => userToSocket.get(String(userId));

const removeSocket = (socketId) => {
  const userId = socketToUser.get(socketId);
  if (userId) {
    userToSocket.delete(userId);
  }
  socketToUser.delete(socketId);
  return userId;
};

module.exports = { setUserSocket, getSocketId, removeSocket };

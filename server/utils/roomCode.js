const { customAlphabet } = require('nanoid');

const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const nanoid = customAlphabet(alphabet, 6);

const generateRoomCode = () => nanoid();

module.exports = { generateRoomCode };

const express = require('express');
const { body } = require('express-validator');
const auth = require('../middleware/auth');
const validate = require('../middleware/validate');
const {
  createRoom,
  joinRoom,
  studyWithFriend,
  listRooms,
  getRoom,
  inviteUser,
  addNote,
  listNotes
} = require('../controllers/roomController');

const router = express.Router();

router.post(
  '/',
  auth,
  [body('name').isLength({ min: 2, max: 80 })],
  validate,
  createRoom
);

router.post(
  '/join',
  auth,
  [body('code').isLength({ min: 4 })],
  validate,
  joinRoom
);

router.post(
  '/study-with',
  auth,
  [body('friendId').isMongoId()],
  validate,
  studyWithFriend
);

router.get('/', auth, listRooms);
router.get('/:code', auth, getRoom);
router.get('/:code/notes', auth, listNotes);

router.post(
  '/:code/invite',
  auth,
  [body('userId').isMongoId()],
  validate,
  inviteUser
);

router.post(
  '/:code/notes',
  auth,
  [body('content').isLength({ min: 1, max: 2000 })],
  validate,
  addNote
);

module.exports = router;

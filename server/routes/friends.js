const express = require('express');
const { body } = require('express-validator');
const auth = require('../middleware/auth');
const validate = require('../middleware/validate');
const {
  sendRequest,
  acceptRequest,
  rejectRequest,
  listFriends,
  listRequests
} = require('../controllers/friendController');

const router = express.Router();

router.post(
  '/request',
  auth,
  [body('toUserId').isMongoId()],
  validate,
  sendRequest
);

router.post(
  '/accept',
  auth,
  [body('requestId').isMongoId()],
  validate,
  acceptRequest
);

router.post(
  '/reject',
  auth,
  [body('requestId').isMongoId()],
  validate,
  rejectRequest
);

router.get('/list', auth, listFriends);
router.get('/requests', auth, listRequests);

module.exports = router;

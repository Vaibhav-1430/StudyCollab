const express = require('express');
const { body } = require('express-validator');
const validate = require('../middleware/validate');
const auth = require('../middleware/auth');
const { register, login, demoLogin, me, logout } = require('../controllers/authController');

const router = express.Router();

router.post(
  '/register',
  [
    body('name').isLength({ min: 2, max: 60 }),
    body('email').isEmail(),
    body('password').isLength({ min: 8 })
  ],
  validate,
  register
);

router.post(
  '/login',
  [body('email').isEmail(), body('password').notEmpty()],
  validate,
  login
);

router.post('/demo', demoLogin);

router.get('/me', auth, me);
router.post('/logout', auth, logout);

module.exports = router;

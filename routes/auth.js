// routes/auth.js
const express = require('express');
const router = express.Router();
const auth = require('../controllers/authController');
const authMiddleware = require('../middleware/auth');

router.post('/register', auth.registerBusiness);
router.post('/login/business', auth.loginBusiness);
router.post('/login/agent', auth.loginAgent);
router.post('/login/super-admin', auth.loginSuperAdmin);
router.post('/change-password', authMiddleware(['agent', 'main_agent']), auth.changePassword);
router.post('/forgot-password', auth.forgotPassword);

module.exports = router;

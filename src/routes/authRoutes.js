const express = require('express');
const router = express.Router();
const { requestOtp, verifyOtp, updateProfile, savePushToken } = require('../controllers/authController');
const { protect } = require('../middlewares/authMiddleware');

router.post('/request-otp', requestOtp);
router.post('/verify-otp', verifyOtp);
// این روت نیاز به توکن داره، پس protect رو می‌ذاریم
router.put('/complete-profile', protect, updateProfile);

// src/routes/authRoutes.js — یه خط اضافه کن
// در authRoutes.js
router.post('/log', async (req, res) => {
  console.log('📱 [Mobile Log]:', req.body.message);
  res.status(200).json({ ok: true });
});
router.put('/push-token', protect, savePushToken); // 👈 اضافه کن
module.exports = router;

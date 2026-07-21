const express = require('express');
const router = express.Router();
const { requestOtp, verifyOtp, updateProfile } = require('../controllers/authController');
const { protect } = require('../middlewares/authMiddleware');

router.post('/request-otp', requestOtp);
router.post('/verify-otp', verifyOtp);
// این روت نیاز به توکن داره، پس protect رو می‌ذاریم
router.put('/complete-profile', protect, updateProfile);

router.put('/push-token', protect, savePushToken); // 👈 اضافه کن

module.exports = router;

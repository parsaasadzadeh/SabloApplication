const express = require('express');
const router = express.Router();
const { requestOtp, verifyOtp, updateProfile, savePushToken  ,  updateCurrency, getMe } = require('../controllers/authController');
const { protect } = require('../middlewares/authMiddleware');

router.post('/request-otp', requestOtp);
router.post('/verify-otp', verifyOtp);
router.put('/complete-profile', protect, updateProfile);

router.post('/log', async (req, res) => {
  console.log('📱 [Mobile Log]:', req.body.message);
  res.status(200).json({ ok: true });
});
router.put('/push-token', protect, savePushToken); 
router.get('/me', protect, getMe);
router.patch('/currency', protect, updateCurrency);
module.exports = router;

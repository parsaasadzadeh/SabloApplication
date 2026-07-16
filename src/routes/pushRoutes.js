// مسیر: src/routes/pushRoutes.js
const express = require('express');
const router = express.Router();
const { registerPushToken, removePushToken } = require('../controllers/pushController');
const { protect } = require('../middlewares/authMiddleware');

router.use(protect);
router.post('/push-token', registerPushToken);
router.delete('/push-token', removePushToken);

module.exports = router;

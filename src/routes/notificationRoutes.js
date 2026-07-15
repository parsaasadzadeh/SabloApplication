const express = require('express');
const router = express.Router();
const {
    getMyNotifications,
    markAsRead,
    registerPushToken,
} = require('../controllers/notificationController');
const { protect } = require('../middlewares/authMiddleware');

router.use(protect);

router.get('/', getMyNotifications);
router.put('/:id/read', markAsRead);
router.post('/register-push-token', registerPushToken);

module.exports = router;

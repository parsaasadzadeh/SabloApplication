const express = require('express');
const router = express.Router();
const { getMyNotifications, markAsRead } = require('../controllers/notificationController');
const { protect } = require('../middlewares/authMiddleware');

router.use(protect); // همه روت‌های پیام نیاز به لاگین دارن

router.get('/', getMyNotifications);
router.put('/:id/read', markAsRead);

module.exports = router;
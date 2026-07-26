const Notification = require('../models/Notification');
exports.getMyNotifications = async (req, res) => {
    try {
        const notifications = await Notification.find({ userId: req.user.id })
            .sort({ createdAt: -1 }) 
            .limit(20); 
        const unreadCount = await Notification.countDocuments({ userId: req.user.id, isRead: false });
        res.status(200).json({ unreadCount, notifications });
    } catch (error) {
        res.status(500).json({ message: 'خطای سرور', error: error.message });
    }
};

exports.markAsRead = async (req, res) => {
    try {
        await Notification.findByIdAndUpdate(req.params.id, { isRead: true });
        res.status(200).json({ message: 'پیام خوانده شد' });
    } catch (error) {
        res.status(500).json({ message: 'خطای سرور', error: error.message });
    }
};

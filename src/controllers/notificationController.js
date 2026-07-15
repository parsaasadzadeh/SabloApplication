const Notification = require('../models/Notification');
const User = require('../models/User');
const axios = require('axios');

// ── ارسال Push Notification از طریق Expo ─────────────────────────────────────
async function sendPushNotification(pushToken, title, message) {
    if (!pushToken || !pushToken.startsWith('ExponentPushToken')) return;

    try {
        await axios.post(
            'https://exp.host/--/api/v2/push/send',
            {
                to: pushToken,
                title,
                body: message,
                sound: 'default',
                priority: 'high',
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                },
                timeout: 10000,
            }
        );
    } catch (err) {
        console.error('خطا در ارسال push notification:', err.message);
    }
}

// ── ثبت توکن push کاربر ───────────────────────────────────────────────────────
exports.registerPushToken = async (req, res) => {
    try {
        const { pushToken } = req.body;

        if (!pushToken) {
            return res.status(400).json({ message: 'pushToken الزامی است' });
        }

        await User.findByIdAndUpdate(req.user.id, { pushToken });

        res.status(200).json({ message: 'توکن با موفقیت ثبت شد' });
    } catch (error) {
        res.status(500).json({ message: 'خطای سرور', error: error.message });
    }
};

// ── دریافت لیست اعلان‌های کاربر ──────────────────────────────────────────────
exports.getMyNotifications = async (req, res) => {
    try {
        const notifications = await Notification.find({ userId: req.user.id })
            .sort({ createdAt: -1 })
            .limit(20);

        const unreadCount = await Notification.countDocuments({
            userId: req.user.id,
            isRead: false,
        });

        res.status(200).json({ unreadCount, notifications });
    } catch (error) {
        res.status(500).json({ message: 'خطای سرور', error: error.message });
    }
};

// ── خوانده شدن اعلان ─────────────────────────────────────────────────────────
exports.markAsRead = async (req, res) => {
    try {
        await Notification.findByIdAndUpdate(req.params.id, { isRead: true });
        res.status(200).json({ message: 'پیام خوانده شد' });
    } catch (error) {
        res.status(500).json({ message: 'خطای سرور', error: error.message });
    }
};

// export کردن تابع push برای استفاده در checkInstallments
module.exports.sendPushNotification = sendPushNotification;

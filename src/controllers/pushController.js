// مسیر: src/controllers/pushController.js
const User = require('../models/User');
const { Expo } = require('expo-server-sdk');

// ثبت یا آپدیت توکن پوش کاربر
exports.registerPushToken = async (req, res) => {
    try {
        const { pushToken, platform } = req.body;

        if (!pushToken || !Expo.isExpoPushToken(pushToken)) {
            return res.status(400).json({ message: 'توکن پوش نامعتبر است' });
        }
        if (!['ios', 'android'].includes(platform)) {
            return res.status(400).json({ message: 'پلتفرم نامعتبر است' });
        }

        const user = await User.findById(req.user.id);

        const existing = user.pushTokens.find((t) => t.token === pushToken);
        if (existing) {
            existing.updatedAt = new Date();
            existing.platform = platform;
        } else {
            user.pushTokens.push({ token: pushToken, platform, updatedAt: new Date() });
        }

        await user.save();
        res.status(200).json({ message: 'توکن ثبت شد' });
    } catch (error) {
        res.status(500).json({ message: 'خطای سرور', error: error.message });
    }
};

// حذف توکن (مثلاً موقع لاگ‌اوت)
exports.removePushToken = async (req, res) => {
    try {
        const { pushToken } = req.body;
        await User.updateOne(
            { _id: req.user.id },
            { $pull: { pushTokens: { token: pushToken } } }
        );
        res.status(200).json({ message: 'توکن حذف شد' });
    } catch (error) {
        res.status(500).json({ message: 'خطای سرور', error: error.message });
    }
};

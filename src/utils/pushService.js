// مسیر: src/utils/pushService.js
const { Expo } = require('expo-server-sdk');
const User = require('../models/User');

const expo = new Expo();

/**
 * ارسال نوتیف به یک کاربر خاص (روی همه‌ی دستگاه‌هایی که ثبت کرده)
 * @param {string} userId
 * @param {{title: string, body: string, data?: object}} payload
 */
async function sendPushToUser(userId, { title, body, data = {} }) {
    const user = await User.findById(userId).select('pushTokens');
    if (!user || !user.pushTokens?.length) return;

    const messages = [];
    for (const { token } of user.pushTokens) {
        if (!Expo.isExpoPushToken(token)) continue;
        messages.push({
            to: token,
            sound: 'default',
            title,
            body,
            data,
            priority: 'high',
        });
    }

    if (!messages.length) return;

    const chunks = expo.chunkPushNotifications(messages);
    const invalidTokens = [];

    for (const chunk of chunks) {
        try {
            const receipts = await expo.sendPushNotificationsAsync(chunk);
            receipts.forEach((receipt, i) => {
                if (receipt.status === 'error' && receipt.details?.error === 'DeviceNotRegistered') {
                    invalidTokens.push(chunk[i].to);
                }
            });
        } catch (error) {
            console.error('❌ خطا در ارسال پوش نوتیفیکیشن:', error.message);
        }
    }

    // پاک‌سازی توکن‌های نامعتبر (کاربر اپ رو حذف کرده یا permission رو برداشته)
    if (invalidTokens.length) {
        await User.updateOne(
            { _id: userId },
            { $pull: { pushTokens: { token: { $in: invalidTokens } } } }
        );
    }
}

module.exports = { sendPushToUser };

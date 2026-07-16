const User = require('../models/User');

let expoInstance = null;
async function getExpo() {
    if (!expoInstance) {
        const { Expo } = await import('expo-server-sdk');
        expoInstance = new Expo();
    }
    return expoInstance;
}

async function sendPushToUser(userId, { title, body, data = {} }) {
    const expo = await getExpo();
    const { Expo } = await import('expo-server-sdk');

    const user = await User.findById(userId).select('pushTokens');
    if (!user || !user.pushTokens?.length) return;

    const messages = [];
    for (const { token } of user.pushTokens) {
        if (!Expo.isExpoPushToken(token)) continue;
        messages.push({ to: token, sound: 'default', title, body, data, priority: 'high'  , channelId: 'default' });
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

    if (invalidTokens.length) {
        await User.updateOne(
            { _id: userId },
            { $pull: { pushTokens: { token: { $in: invalidTokens } } } }
        );
    }
}

module.exports = { sendPushToUser };

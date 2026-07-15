// مسیر پیشنهادی: src/utils/sendPush.js
// پیش‌نیاز: npm install expo-server-sdk
//
// نکته: نسخه‌ی جدید expo-server-sdk به‌صورت ESM هست، پس نمی‌شه با require() عادی
// لودش کرد. به همین خاطر از import() پویا (dynamic import) استفاده می‌کنیم که
// داخل فایل‌های CommonJS هم مشکلی نداره.

const User = require('../models/User');

let expoInstance = null;

// فقط بار اول Expo رو لود و کش می‌کنه، دفعات بعد از همون نسخه‌ی کش‌شده استفاده می‌کنه
async function getExpo() {
    if (!expoInstance) {
        const { Expo } = await import('expo-server-sdk');
        expoInstance = new Expo();
    }
    return expoInstance;
}

/**
 * برای یک کاربر خاص (با userId) پوش نوتیفیکیشن واقعی می‌فرسته.
 * روی همه‌ی دستگاه‌های ثبت‌شده‌ی اون کاربر ارسال می‌کنه (چون pushTokens یه آرایه‌ست).
 */
async function sendPushToUser(userId, { title, body, data = {} }) {
    try {
        const user = await User.findById(userId);
        if (!user || !user.pushTokens || user.pushTokens.length === 0) {
            console.log(`ℹ️ کاربر ${userId} توکن پوش ثبت‌شده نداره، ارسال انجام نشد.`);
            return;
        }

        const { Expo } = await import('expo-server-sdk');
        const expo = await getExpo();

        const messages = [];
        for (const pushToken of user.pushTokens) {
            if (!Expo.isExpoPushToken(pushToken)) {
                console.log(`⚠️ توکن نامعتبر برای کاربر ${userId}: ${pushToken}`);
                continue;
            }
            messages.push({
                to: pushToken,
                sound: 'default',
                title,
                body,
                data,
                priority: 'high',
            });
        }

        if (messages.length === 0) return;

        const chunks = expo.chunkPushNotifications(messages);
        const invalidTokens = [];

        for (const chunk of chunks) {
            try {
                const ticketChunk = await expo.sendPushNotificationsAsync(chunk);

                ticketChunk.forEach((ticket, i) => {
                    if (ticket.status === 'error') {
                        console.error(`❌ خطای ارسال پوش:`, ticket.message, ticket.details);
                        if (ticket.details?.error === 'DeviceNotRegistered') {
                            invalidTokens.push(chunk[i].to);
                        }
                    }
                });
            } catch (error) {
                console.error('❌ خطا در ارسال دسته‌ی پوش:', error.message);
            }
        }

        if (invalidTokens.length > 0) {
            await User.updateOne(
                { _id: userId },
                { $pull: { pushTokens: { $in: invalidTokens } } }
            );
        }

        console.log(`✅ پوش برای کاربر ${userId} روی ${messages.length} دستگاه ارسال شد.`);
    } catch (error) {
        console.error(`❌ خطای کلی در sendPushToUser برای کاربر ${userId}:`, error.message);
    }
}

module.exports = { sendPushToUser };

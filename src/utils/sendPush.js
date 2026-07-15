// مسیر پیشنهادی: src/utils/sendPush.js
// پیش‌نیاز: npm install expo-server-sdk

const { Expo } = require('expo-server-sdk');
const User = require('../models/User');

const expo = new Expo();

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
                        // اگه توکن دیگه معتبر نیست (مثلاً کاربر اپ رو حذف کرده)، بعداً حذفش می‌کنیم
                        if (ticket.details?.error === 'DeviceNotRegistered') {
                            invalidTokens.push(chunk[i].to);
                        }
                    }
                });
            } catch (error) {
                console.error('❌ خطا در ارسال دسته‌ی پوش:', error.message);
            }
        }

        // توکن‌های منقضی‌شده رو از دیتابیس پاک کن تا دفعه‌ی بعد دوباره خطا نده
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

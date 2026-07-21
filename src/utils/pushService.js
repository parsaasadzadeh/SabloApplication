// src/utils/pushService.js  ← فایل جدید بساز
const axios = require('axios');

async function sendExpoPush(expoPushToken, title, message) {
    // توکن معتبر نباشه، skip کن
    if (!expoPushToken || !expoPushToken.startsWith('ExponentPushToken[')) {
        return;
    }

    try {
        await axios.post(
            'https://exp.host/--/api/v2/push/send',
            {
                to: expoPushToken,
                title,
                body: message,
                sound: 'default',
                priority: 'high',
                channelId: 'installment-reminders', // برای اندروید
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                },
                timeout: 10000
            }
        );
        console.log(`📱 Push ارسال شد به: ${expoPushToken}`);
    } catch (err) {
        // push fail نباید کل cron رو خراب کنه
        console.error('❌ خطا در ارسال push:', err.message);
    }
}

module.exports = { sendExpoPush };

// src/utils/pushService.js
const axios = require('axios');

async function sendPushNotifications(messages) {
    const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

    const validMessages = messages
        .filter(m => m.token && m.token.startsWith('ExponentPushToken['))
        .map(m => ({
            to:       m.token,
            sound:    'default',
            title:    m.title,
            body:     m.body,
            data:     m.data || {},
            priority: 'high',
        }));

    if (validMessages.length === 0) return [];

    try {
        const response = await axios.post(EXPO_PUSH_URL, validMessages, {
            headers: {
                'Accept':       'application/json',
                'Content-Type': 'application/json',
            },
        });

        console.log(`📲 ${validMessages.length} push ارسال شد.`);
        return response.data.data || [];
    } catch (err) {
        console.error('❌ خطا در ارسال push:', err.message);
        return [];
    }
}

module.exports = { sendPushNotifications };

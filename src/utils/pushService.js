// src/utils/pushService.js
const { Expo } = require('expo-server-sdk');
const expo = new Expo();

/**
 * ارسال push notification به یک یا چند کاربر
 * @param {Array<{token: string, title: string, body: string, data?: object}>} messages
 */
async function sendPushNotifications(messages) {
    const chunks = expo.chunkPushNotifications(
        messages
            .filter(m => Expo.isExpoPushToken(m.token))
            .map(m => ({
                to:    m.token,
                sound: 'default',
                title: m.title,
                body:  m.body,
                data:  m.data || {},
                priority: 'high',
            }))
    );

    const tickets = [];
    for (const chunk of chunks) {
        try {
            const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
            tickets.push(...ticketChunk);
        } catch (err) {
            console.error('❌ خطا در ارسال push:', err.message);
        }
    }
    return tickets;
}

module.exports = { sendPushNotifications };

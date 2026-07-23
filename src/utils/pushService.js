const axios = require('axios');

async function sendExpoPush(playerId, title, message) {
  if (!playerId) {
    console.log('📱 playerId نداریم - skip');
    return;
  }

  try {
    const res = await axios.post(
      'https://onesignal.com/api/v1/notifications',
      {
        app_id: process.env.ONESIGNAL_APP_ID,
        include_subscription_ids: [playerId],
        headings: { en: title, fa: title },
        contents: { en: message, fa: message },
        sound: 'default',
      },
      {
        headers: {
          Authorization: `Basic ${process.env.ONESIGNAL_API_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }
    );
    console.log(`📱 Push ارسال شد:`, res.data);
  } catch (err) {
    console.error('❌ خطا در ارسال push:', err.message);
  }
}

module.exports = { sendExpoPush };

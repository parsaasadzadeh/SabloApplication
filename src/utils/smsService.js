const axios = require('axios');

const SMSIR_BASE_URL = 'https://api.sms.ir/v1/send/verify';

async function sendOtp(mobile, code) {
    const apiKey = process.env.SMSIR_API_KEY;
    const templateId = process.env.SMSIR_TEMPLATE_ID;

    if (!apiKey || !templateId) {
        throw new Error('متغیرهای SMSIR_API_KEY یا SMSIR_TEMPLATE_ID در .env تنظیم نشده‌اند');
    }

    try {
        const response = await axios.post(
            SMSIR_BASE_URL,
            {
                mobile,
                templateId: Number(templateId),
                parameters: [
                    { name: 'CODE', value: code }
                ]
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'text/plain',
                    'X-API-KEY': apiKey
                },
                timeout: 10000
            }
        );

        const data = response.data;
        if (data.status === 1) {
            return { success: true, messageId: data.data.messageId, cost: data.data.cost };
        }
        return { success: false, error: data.message || 'ارسال پیامک ناموفق بود' };

    } catch (err) {
        const apiError = err.response?.data?.message;
        console.error('SMS.ir error:', apiError || err.message);
        return { success: false, error: apiError || 'خطا در ارتباط با سرویس پیامک' };
    }
}

async function sendInstallmentReminder(mobile, installmentTitle, reminderType) {
    const apiKey = process.env.SMSIR_API_KEY;
    const templateId = process.env.SMSIR_INSTALLMENT_TEMPLATE_ID;

    if (!apiKey || !templateId) {
        console.warn('⚠️ SMSIR_INSTALLMENT_TEMPLATE_ID در .env تنظیم نشده - SMS ارسال نشد');
        return { success: false, error: 'templateId تنظیم نشده' };
    }

    // ✅ متن بر اساس نوع یادآوری
    const reminderText = reminderType === 'UPCOMING_DUE_DATE'
        ? `فردا موعد پرداخت قسط ${installmentTitle} است`
        : `امروز موعد پرداخت قسط ${installmentTitle} است`;

    try {
        const response = await axios.post(
            SMSIR_BASE_URL,
            {
                mobile,
                templateId: Number(templateId),
                parameters: [
                    { name: 'TITLE', value: reminderText }
                ]
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'text/plain',
                    'X-API-KEY': apiKey
                },
                timeout: 10000
            }
        );

        const data = response.data;
        if (data.status === 1) {
            return { success: true, messageId: data.data.messageId };
        }
        return { success: false, error: data.message || 'ارسال پیامک ناموفق بود' };

    } catch (err) {
        const apiError = err.response?.data?.message;
        console.error('SMS.ir installment reminder error:', apiError || err.message);
        return { success: false, error: apiError || 'خطا در ارتباط با سرویس پیامک' };
    }
}

module.exports = { sendOtp, sendInstallmentReminder };

const axios = require('axios');

const SMSIR_BASE_URL = 'https://api.sms.ir/v1/send/verify';

/**
 * ارسال کد تایید (OTP) از طریق سرویس Verify سامانه sms.ir
 * مستندات: https://apidocs.sms.ir
 *
 * @param {string} mobile - شماره موبایل گیرنده (مثال: 09123456789)
 * @param {string} code - کد تایید تولید شده
 * @returns {Promise<{success: boolean, messageId?: number, cost?: number, error?: string}>}
 */
async function sendOtp(mobile, code) {
    const apiKey = process.env.SMSIR_API_KEY;
    const templateId = process.env.SMSIR_TEMPLATE_ID; // برای شما: 769990

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
                    { name: 'CODE', value: code } // باید دقیقا با #CODE# توی متن قالب شما (769990) مطابقت داشته باشد
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

        // status: 1 یعنی موفق، طبق جدول کدهای وضعیت sms.ir
        if (data.status === 1) {
            return { success: true, messageId: data.data.messageId, cost: data.data.cost };
        }

        return { success: false, error: data.message || 'ارسال پیامک ناموفق بود' };
    } catch (err) {
        // اگر خود سرویس sms.ir خطای HTTP برگردونه (401, 400 و ...)
        const apiError = err.response?.data?.message;
        console.error('SMS.ir error:', apiError || err.message);
        return { success: false, error: apiError || 'خطا در ارتباط با سرویس پیامک' };
    }
}

module.exports = { sendOtp };

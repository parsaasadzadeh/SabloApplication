const User = require('../models/User');
const Otp = require('../models/Otp');
const jwt = require('jsonwebtoken');
const { sendOtp } = require('../utils/smsService');

// ---------- محدودیت ارسال کد ----------
const MAX_OTP_REQUESTS = 3;            // حداکثر ۳ بار ارسال پشت سر هم
const BLOCK_MS = 5 * 60 * 1000;        // بعد از ۳ بار، ۵ دقیقه محدودیت

const otpAttempts = new Map(); // phone -> { count, resetAt }

// هر ۵ دقیقه رکوردهای تمام‌شده پاک میشن تا حافظه پر نشه
setInterval(() => {
    const now = Date.now();
    for (const [phone, entry] of otpAttempts) {
        if (now > entry.resetAt) otpAttempts.delete(phone);
    }
}, 5 * 60 * 1000).unref();

function checkAndRegisterOtp(phone) {
    const now = Date.now();
    let entry = otpAttempts.get(phone);

    // محدودیت تموم شده یا پنجره منقضی شده -> از اول
    if (entry && now > entry.resetAt) {
        otpAttempts.delete(phone);
        entry = null;
    }

    // به سقف ۳ بار رسیده -> بلاک
    if (entry && entry.count >= MAX_OTP_REQUESTS) {
        return { allowed: false, retryAfter: Math.ceil((entry.resetAt - now) / 1000) };
    }

    if (!entry) entry = { count: 0, resetAt: now + BLOCK_MS };
    entry.count += 1;
    // با سومین ارسال، ۵ دقیقه‌ی محدودیت از همین لحظه شروع میشه
    if (entry.count >= MAX_OTP_REQUESTS) entry.resetAt = now + BLOCK_MS;

    otpAttempts.set(phone, entry);
    return { allowed: true };
}

// اگه ارسال پیامک ناموفق بود، یک شانس از کاربر کم نشه
function rollbackOtp(phone) {
    const entry = otpAttempts.get(phone);
    if (!entry) return;
    entry.count -= 1;
    if (entry.count <= 0) otpAttempts.delete(phone);
}

// ---------- نرمال‌سازی شماره ----------
function normalizePhone(input) {
    let p = String(input || '').replace(/[\s\-()]/g, '');
    p = p.replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
         .replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
    if (p.startsWith('+98')) p = '0' + p.slice(3);
    else if (p.startsWith('0098')) p = '0' + p.slice(4);
    else if (p.startsWith('98')) p = '0' + p.slice(2);
    else if (p.startsWith('9')) p = '0' + p;
    return /^09\d{9}$/.test(p) ? p : null;
}

exports.requestOtp = async (req, res) => {
    try {
        const phone = normalizePhone(req.body.phone);
        if (!phone) return res.status(400).json({ message: 'شماره موبایل نامعتبر است' });

        const limit = checkAndRegisterOtp(phone);
        if (!limit.allowed) {
            return res.status(429).json({
                message: 'تعداد درخواست‌ها بیش از حد مجاز است، چند دقیقه بعد دوباره تلاش کنید',
                retryAfter: limit.retryAfter
            });
        }

        const code = Math.floor(10000 + Math.random() * 90000).toString();

        const smsResult = await sendOtp(phone, code);
        if (!smsResult.success) {
            rollbackOtp(phone);
            console.error('SMS error:', smsResult.error);
            return res.status(502).json({ message: 'ارسال پیامک ناموفق بود، لطفا دوباره تلاش کنید' });
        }

        await Otp.deleteMany({ phone });
        await Otp.create({ phone, code });
        res.status(200).json({ message: 'کد با موفقیت ارسال شد' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'خطای سرور' });
    }
};

exports.verifyOtp = async (req, res) => {
    try {
        const phone = normalizePhone(req.body.phone);
        const { code } = req.body;
        if (!phone) return res.status(400).json({ message: 'شماره موبایل نامعتبر است' });

        const validOtp = await Otp.findOne({ phone, code });
        if (!validOtp) return res.status(400).json({ message: 'کد نامعتبر است یا منقضی شده' });
        let user = await User.findOne({ phone });
        let isNewUser = false;
        // اگر کاربر وجود نداشت، فقط با شماره موبایل می‌سازیمش
        if (!user) {
            user = await User.create({ phone });
            isNewUser = true; // این فلگ به فرانت می‌گه کاربر جدیده
        }
        const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '30d' });
        await Otp.deleteMany({ phone });
        // بررسی می‌کنیم که آیا کاربر اسم داره یا نه
        const needsProfileCompletion = isNewUser || !user.name;
        res.status(200).json({
            message: 'با موفقیت وارد شدید',
            token,
            user,
            needsProfileCompletion
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'خطای سرور' });
    }
};

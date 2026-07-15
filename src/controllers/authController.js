const User = require('../models/User');
const Otp = require('../models/Otp');
const jwt = require('jsonwebtoken');

// درخواست کد OTP (بدون تغییر)
exports.requestOtp = async (req, res) => {
    try {
        const { phone } = req.body;
        if (!phone) return res.status(400).json({ message: 'شماره موبایل الزامی است' });

        const code = Math.floor(10000 + Math.random() * 90000).toString();
        await Otp.deleteMany({ phone });
        await Otp.create({ phone, code });

        console.log(`OTP for ${phone} is: ${code}`);
        res.status(200).json({ message: 'کد با موفقیت ارسال شد', code }); 
    } catch (error) {
        res.status(500).json({ message: 'خطای سرور', error: error.message });
    }
};

// تایید کد و ورود/ثبت‌نام اولیه (بدون نیاز به نام)
exports.verifyOtp = async (req, res) => {
    try {
        const { phone, code } = req.body;

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
            needsProfileCompletion // فرانت با این مقدار می‌فهمه باید بره به صفحه complete-profile
        });
    } catch (error) {
        res.status(500).json({ message: 'خطای سرور', error: error.message });
    }
};

// آپدیت نام کاربر (برای استفاده در مسیر complete-profile و ویرایش پروفایل)
exports.updateProfile = async (req, res) => {
    try {
        const { name } = req.body;
        if (!name) return res.status(400).json({ message: 'نام الزامی است' });

        // آپدیت کاربری که لاگین کرده (آیدیش از توکن میاد)
        const updatedUser = await User.findByIdAndUpdate(
            req.user.id, 
            { name }, 
            { new: true } // نسخه جدید داکیومنت رو برگردون
        );

        res.status(200).json({ message: 'پروفایل با موفقیت تکمیل شد', user: updatedUser });
    } catch (error) {
        res.status(500).json({ message: 'خطای سرور', error: error.message });
    }
};

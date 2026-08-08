// src/controllers/version.controller.js
const compareVersions = require('../utils/compareVersions');

exports.checkVersion = (req, res) => {
  try {
    const currentVersion = req.query.version; // ورژن نصب‌شده روی گوشی کاربر
    const latestVersion = process.env.APP_LATEST_VERSION || '2.0.3';
    const storeUrl = process.env.APP_STORE_URL || 'https://myket.ir/app/com.sabloapp.sablo';

    // اگه اپ قدیمیه و اصلاً پارامتر version رو نمی‌فرسته،
    // برای احتیاط فرض می‌کنیم آپدیت لازمه
    const forceUpdate = currentVersion
      ? compareVersions(currentVersion, latestVersion) < 0
      : true;

    res.status(200).json({
      latestVersion,
      forceUpdate,
      storeUrl,
      message: forceUpdate
        ? 'نسخه جدید برنامه حسابداری Sablo منتشر شد. برای تجربه بهتر و امنیت بیشتر، لطفاً برنامه را بروزرسانی کنید.'
        : 'شما از آخرین نسخه برنامه استفاده می‌کنید.'
    });
  } catch (error) {
    res.status(500).json({ message: 'خطا در بررسی نسخه اپلیکیشن' });
  }
};

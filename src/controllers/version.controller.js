function compareVersions(v1, v2) {
  const p1 = v1.split('.').map(Number);
  const p2 = v2.split('.').map(Number);
  for (let i = 0; i < Math.max(p1.length, p2.length); i++) {
    const a = p1[i] || 0;
    const b = p2[i] || 0;
    if (a > b) return 1;
    if (a < b) return -1;
  }
  return 0;
}

exports.checkVersion = (req, res) => {
  try {
    const latestVersion = process.env.APP_LATEST_VERSION || '2.0.3';
    const minVersion = process.env.APP_MIN_VERSION || '2.0.1';
    const forceUpdateEnabled = process.env.FORCE_UPDATE_ENABLED === 'true';

    // اگه کلاینت (به هر دلیلی، الان یا در آینده) نسخه‌ش رو فرستاد
    const currentVersion = req.query.currentVersion;

    let forceUpdate;
    if (currentVersion) {
      // per-device: فقط اگه نسخه کاربر از minVersion پایین‌تره
      forceUpdate = forceUpdateEnabled && compareVersions(currentVersion, minVersion) < 0;
    } else {
      // فرانت فعلی نسخه نمی‌فرسته -> رفتار global طبق env
      forceUpdate = forceUpdateEnabled;
    }

    res.status(200).json({
      latestVersion,
      minVersion,
      forceUpdate,
      storeUrl: process.env.APP_STORE_URL || 'https://myket.ir/app/com.sabloapp.sablo',
      message: 'نسخه جدید برنامه حسابداری Sablo منتشر شد. برای تجربه بهتر و امنیت بیشتر، برنامه را بروزرسانی کنید.'
    });
  } catch (error) {
    res.status(500).json({ message: 'خطا در بررسی نسخه اپلیکیشن' });
  }
};

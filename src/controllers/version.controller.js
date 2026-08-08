// یه تابع ساده برای مقایسه نسخه‌ها (semver ساده مثل 2.0.1)
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
    const currentVersion = req.query.currentVersion || req.query.version;
    const latestVersion = process.env.APP_LATEST_VERSION || '2.0.3';
    const minVersion = process.env.APP_MIN_VERSION || '2.0.1';
    const forceUpdateEnabled = process.env.FORCE_UPDATE_ENABLED === 'true';

    let updateAvailable = false;
    let forceUpdate = false;

    if (currentVersion) {
      // اگه نسخه فعلی از آخرین نسخه قدیمی‌تره -> اعلان آپدیت (اختیاری)
      updateAvailable = compareVersions(currentVersion, latestVersion) < 0;

      // فورس‌آپدیت فقط به minVersion وابسته‌ست، نه latestVersion
      forceUpdate = forceUpdateEnabled && compareVersions(currentVersion, minVersion) < 0;
    } else {
      // اگه کلاینت نسخه نفرستاد، فقط طبق قدیمی روش قبلی برمی‌گردونیم (فallback)
      updateAvailable = true;
      forceUpdate = forceUpdateEnabled;
    }

    res.status(200).json({
      latestVersion,
      minVersion,
      updateAvailable,
      forceUpdate,
      storeUrl: process.env.APP_STORE_URL || 'https://myket.ir/app/com.sabloapp.sablo',
      message: 'نسخه جدید برنامه حسابداری Sablo منتشر شد. برای تجربه بهتر و امنیت بیشتر، برنامه را بروزرسانی کنید.'
    });
  } catch (error) {
    res.status(500).json({ message: 'خطا در بررسی نسخه اپلیکیشن' });
  }
};

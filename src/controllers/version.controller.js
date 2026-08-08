const compareVersions = (v1, v2) => {
  const a = v1.split('.').map(Number);
  const b = v2.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((a[i] || 0) < (b[i] || 0)) return -1;
    if ((a[i] || 0) > (b[i] || 0)) return 1;
  }
  return 0;
};

exports.checkVersion = (req, res) => {
  try {
    const latestVersion = process.env.APP_LATEST_VERSION ;
    const minVersion = process.env.APP_MIN_VERSION;
    const forceUpdateEnabled = process.env.FORCE_UPDATE_ENABLED === 'true';

    // نسخه کاربر رو از هدر بخون
    const userVersion = req.headers['x-app-version'] || latestVersion;

    // forceUpdate فقط اگه نسخه کاربر کمتر از minVersion باشه
    const forceUpdate = forceUpdateEnabled && compareVersions(userVersion, minVersion) < 0;

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

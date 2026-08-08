exports.checkVersion = (req, res) => {
  try {
    res.status(200).json({
      latestVersion: process.env.APP_LATEST_VERSION,
      minVersion: process.env.APP_MIN_VERSION,
      forceUpdate: process.env.FORCE_UPDATE_ENABLED === 'true',
      storeUrl: process.env.APP_STORE_URL || 'https://myket.ir/app/com.sabloapp.sablo',
      message: 'نسخه جدید برنامه حسابداری Sablo منتشر شد. برای تجربه بهتر و امنیت بیشتر، برنامه را بروزرسانی کنید.'
    });
  } catch (error) {
    res.status(500).json({ message: 'خطا در بررسی نسخه اپلیکیشن' });
  }
};

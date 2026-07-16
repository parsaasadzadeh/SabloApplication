exports.checkVersion = (req, res) => {
  try {
    res.status(200).json({
      latestVersion: process.env.APP_LATEST_VERSION || '1.0.0',
      storeUrl: process.env.APP_STORE_URL || 'myket://details?id=com.parsaas.Sablo',
      message: 'نسخه جدید برنامه حسابداری Sablo منتشر شد. برای تجربه بهتر و امنیت بیشتر، برنامه را بروزرسانی کنید.'
    });
  } catch (error) {
    res.status(500).json({ message: 'خطا در بررسی نسخه اپلیکیشن' });
  }
};

exports.checkVersion = (req, res) => {
  try {
    const forceUpdate = process.env.FORCE_UPDATE === 'true';

    res.status(200).json({
      forceUpdate,
      storeUrl: process.env.APP_STORE_URL || 'https://myket.ir/app/com.sabloapp.sablo',
      message: process.env.UPDATE_MESSAGE || 'نسخه جدید منتشر شد. برنامه را بروزرسانی کنید.',
    });
  } catch (error) {
    res.status(500).json({ message: 'خطا در بررسی نسخه' });
  }
};

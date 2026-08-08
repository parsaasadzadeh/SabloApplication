/**
 * controllers/version.controller.js
 *
 * منطق:
 *  - نسخه فعلی اپ کاربر باید در query string با کلید "version" ارسال بشه
 *    مثال: GET /api/version/check?version=1.4.2
 *  - اگر نسخه کاربر از APP_MIN_VERSION پایین‌تر باشه => forceUpdate = true (اجباری)
 *  - اگر نسخه کاربر برابر یا بالاتر از APP_MIN_VERSION باشه => forceUpdate = false
 *    (یعنی حتی اگه نسخه آخر رو نداشته باشه ولی از حداقل نسخه مجاز پایین‌تر نباشه، مودال اجباری نشون داده نمیشه)
 *  - اگر می‌خواید سیاست‌تون دقیقا "فقط آخرین نسخه مجازه" باشه، کافیه در env
 *    مقدار APP_MIN_VERSION رو دقیقا برابر APP_LATEST_VERSION بذارید.
 *  - اگر کلاینت اصلا version نفرسته (مثلا نسخه خیلی قدیمی اپ که هنوز این
 *    قابلیت رو نداشت) با نسخه 0.0.0 در نظر گرفته میشه که باعث میشه —در صورت
 *    فعال بودن اجبار— حتما مجبور به آپدیت بشه.
 */

// الگوی معتبر برای نسخه به فرمت major.minor.patch مثل 1.2.3
const VERSION_REGEX = /^\d+\.\d+\.\d+$/;

/**
 * مقایسه دو نسخه با فرمت "major.minor.patch"
 * @returns {number} -1 اگر v1 < v2 ، 0 اگر برابر، 1 اگر v1 > v2
 */
const compareVersions = (v1, v2) => {
  const normalize = (v) =>
    String(v || '0.0.0')
      .trim()
      .split('.')
      .map((part) => {
        const n = parseInt(part, 10);
        return Number.isNaN(n) ? 0 : n;
      });

  const a = normalize(v1);
  const b = normalize(v2);

  for (let i = 0; i < 3; i++) {
    const ai = a[i] || 0;
    const bi = b[i] || 0;
    if (ai < bi) return -1;
    if (ai > bi) return 1;
  }
  return 0;
};

exports.checkVersion = (req, res) => {
  try {
    const latestVersion = process.env.APP_LATEST_VERSION;
    const minVersion = process.env.APP_MIN_VERSION;
    const forceUpdateEnabled = process.env.FORCE_UPDATE_ENABLED === 'true';
    const storeUrl = process.env.APP_STORE_URL || 'https://myket.ir/app/com.sabloapp.sablo';

    if (!latestVersion || !minVersion) {
      return res.status(500).json({
        message: 'تنظیمات نسخه در سرور به درستی مقداردهی نشده است (APP_LATEST_VERSION / APP_MIN_VERSION)',
      });
    }

    // نسخه‌ای که خود کلاینت (اپ کاربر) ارسال کرده
    const rawUserVersion = req.query.version;
    const isValidFormat =
      typeof rawUserVersion === 'string' && VERSION_REGEX.test(rawUserVersion.trim());

    // اگر نسخه معتبر ارسال نشده باشه، محافظه‌کارانه به‌عنوان قدیمی‌ترین نسخه در نظرش می‌گیریم
    const userVersion = isValidFormat ? rawUserVersion.trim() : '0.0.0';

    // آپدیت اجباریه فقط وقتی که ویژگی فعال باشه و نسخه کاربر از حداقل مجاز پایین‌تر باشه
    const forceUpdate = forceUpdateEnabled && compareVersions(userVersion, minVersion) < 0;

    // آیا اصلا نسخه‌ی جدیدتری از آخرین نسخه منتشر شده وجود داره؟ (فقط اطلاع‌رسانی، غیر اجباری)
    const updateAvailable = compareVersions(userVersion, latestVersion) < 0;

    return res.status(200).json({
      latestVersion,
      minVersion,
      forceUpdate,
      updateAvailable,
      storeUrl,
      message:
        'نسخه جدید برنامه حسابداری Sablo منتشر شد. برای تجربه بهتر و امنیت بیشتر، برنامه را بروزرسانی کنید.',
    });
  } catch (error) {
    console.log('خطا در بررسی نسخه اپلیکیشن:', error);
    return res.status(500).json({ message: 'خطا در بررسی نسخه اپلیکیشن' });
  }
};

// برای تست واحد در صورت نیاز
exports.compareVersions = compareVersions;

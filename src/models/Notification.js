const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true },
    message: { type: String, required: true },
    isRead: { type: Boolean, default: false },
    relatedTransactionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction', default: null },

    // مشخص می‌کنه این اعلان مربوط به کدوم مرحله یادآوریه (۳ روز قبل / ۲ روز قبل / ۱ روز قبل / روز سررسید)
    // برای اعلان‌های دستی یا غیرمرتبط با قسط، مقدارش null می‌مونه
    reminderType: {
        type: String,
        enum: ['3_DAYS_BEFORE', '2_DAYS_BEFORE', '1_DAY_BEFORE', 'DUE_DATE'],
        default: null,
    },

    createdAt: { type: Date, default: Date.now },
});

// جلوگیری از ساخت دو اعلان یکسان برای یک قسط (مثلاً دو بار «۲ روز قبل»)
// sparse: true یعنی این قانون فقط وقتی reminderType مقدار داره اعمال می‌شه
notificationSchema.index(
    { relatedTransactionId: 1, reminderType: 1 },
    { unique: true, sparse: true }
);

// حذف خودکار اعلان‌ها بعد از ۲۰ روز از تاریخ ساخته‌شدنشون (TTL Index)
// MongoDB خودش هر حدود ۶۰ ثانیه یک بار این رکوردهای منقضی‌شده رو پاک می‌کنه
notificationSchema.index(
    { createdAt: 1 },
    { expireAfterSeconds: 20 * 24 * 60 * 60 }
);

module.exports =
    mongoose.models.Notification ||
    mongoose.model('Notification', notificationSchema);

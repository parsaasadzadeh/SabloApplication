// models/SmsImport.js
// پیامک‌های بانکی که فرانت پارس کرده و فرستاده؛ تا وقتی کاربر تأیید نکرده
// داخل Transaction نمی‌روند، پس روی آمار و موجودی هیچ اثری ندارند.
// متن خام پیامک هرگز ذخیره نمی‌شود، فقط hash آن (برای جلوگیری از ثبت تکراری).
// رکوردها بر اساس تاریخ پیامک بعد از RETENTION_DAYS روز خودکار پاک می‌شوند.
const mongoose = require('mongoose');

// باید از MAX_AGE_DAYS در کنترلر (پنجره‌ی پذیرش پیامک) بزرگ‌تر باشد،
// تا پیامک پاک‌شده هرگز دوباره قابل ارسال نباشد.
const RETENTION_DAYS = 35;

const smsImportSchema = new mongoose.Schema(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

        // SHA-256 (hex) که روی خود گوشی ساخته می‌شود
        smsHash: { type: String, required: true, match: /^[a-f0-9]{64}$/ },

        direction: { type: String, enum: ['DEPOSIT', 'WITHDRAW'], required: true },
        type: { type: String, enum: ['INCOME', 'EXPENSE'], required: true },

        amount: { type: Number, required: true, min: 1 },          // ریال، عدد صحیح
        balanceAfter: { type: Number, default: null },             // موجودی بعد از تراکنش (فقط اطلاعاتی)
        date: { type: Date, required: true },

        bank: { type: String, default: '', maxlength: 40 },
        counterparty: { type: String, default: '', maxlength: 60 },
        suggestedTitle: { type: String, default: '', maxlength: 100 },

        status: {
            type: String,
            enum: ['PENDING', 'CONFIRMING', 'CONFIRMED', 'REJECTED'],
            default: 'PENDING',
        },

        // شبیه به یک تراکنش دستی موجود؛ فقط هشدار، نه حذف خودکار
        possibleDuplicateOf: { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction', default: null },

        // در مرحله‌ی claim از قبل مقداردهی می‌شود تا تأیید ناقص باعث تراکنش تکراری نشود
        transactionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction', default: null },
        parserVersion: { type: Number, default: 1 },
        confirmedAt: { type: Date, default: null },
        rejectedAt: { type: Date, default: null },
    },
    { timestamps: true }
);

// ضامن اصلی ضدتکراری: یک پیامک = یک رکورد برای هر کاربر (حتی اگر رد شود)
smsImportSchema.index({ userId: 1, smsHash: 1 }, { unique: true });
smsImportSchema.index({ userId: 1, status: 1, date: -1 });

// پاک‌سازی خودکار (TTL باید روی ایندکس تک‌فیلدی باشد)
smsImportSchema.index({ date: 1 }, { expireAfterSeconds: RETENTION_DAYS * 24 * 60 * 60 });

const SmsImport = mongoose.model('SmsImport', smsImportSchema);
SmsImport.RETENTION_DAYS = RETENTION_DAYS;

module.exports = SmsImport;

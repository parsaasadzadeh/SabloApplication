const mongoose = require('mongoose');
const transactionSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: { 
        type: String, 
        enum: ['INCOME', 'EXPENSE', 'INSTALLMENT', 'LOAN'], 
        required: true 
    },
    amount: { type: Number, required: true },
    title: { type: String, required: true },
    description: { type: String },

    // نکته‌ی مهم: قبلاً اینجا enum ثابتی بود که فقط اجازه‌ی ۱۹ تا دسته‌بندی از پیش
    // تعریف‌شده رو می‌داد. حالا که کاربرها می‌تونن دسته‌بندی شخصی خودشون رو بسازن
    // (مدل Category)، این enum برداشته شده — اعتبارسنجی این‌که یک id واقعاً معتبره
    // (پیش‌فرض یا متعلق به همین کاربر) توی کنترلر انجام می‌شه، نه اینجا.
    // این تغییر روی داده‌های قدیمی هیچ اثری نداره چون فقط یک محدودیت رو شل می‌کنه،
    // چیزی رو سخت‌گیرتر نمی‌کنه.
    category: {
        type: String,
        default: null
    },

    loanId: { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction', default: null },
    
    dueDate: { type: Date }, // تاریخ سررسید قسط یا یادآوری وام
    isPaid: { type: Boolean, default: false }, //وضعیت پرداخت (مخصوص اقساط)
    
    date: { type: Date, default: Date.now }
}, { timestamps: true });
// برای سرعت بالای سرچ بر اساس کاربر و تاریخ
transactionSchema.index({ userId: 1, date: -1 });
module.exports = mongoose.model('Transaction', transactionSchema);


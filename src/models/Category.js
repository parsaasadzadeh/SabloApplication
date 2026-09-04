const mongoose = require('mongoose');

// دسته‌بندی‌های اختصاصی هر کاربر — جدا از لیست پیش‌فرض مشترک (constants/categories.js).
// هر کاربر می‌تونه دسته‌بندی خودش رو بسازه (مثلاً "گازوئیل" برای راننده‌ها)
// بدون این‌که به enum ثابت مدل Transaction دست بزنیم.
const categorySchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    // شناسه‌ی یکتا — از ObjectId خودِ مونگو تولید میشه تا نیازی به slugify متن فارسی نباشه
    // و هیچ‌وقت با id های پیش‌فرض (food, coffee, ...) تداخل نکنه
    id: { type: String, required: true, unique: true },
    label: { type: String, required: true, trim: true, maxlength: 30 },
   icon: { type: String, default: '', trim: true }
}, { timestamps: true });

// سرچ سریع «همه‌ی دسته‌بندی‌های این کاربر»
categorySchema.index({ userId: 1 });

module.exports = mongoose.model('Category', categorySchema);

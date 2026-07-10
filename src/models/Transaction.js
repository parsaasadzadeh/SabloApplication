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
    
    // دسته‌بندی برای تراکنش‌ها (مثلاً: حقوق، اجاره خانه، رستوران)
    category: { type: String, default: 'عمومی' }, 
    
    // اگر تراکنش از نوع قسط (INSTALLMENT) باشه، به کدام وام وصله؟
    loanId: { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction', default: null },
    
    dueDate: { type: Date }, // تاریخ سررسید قسط یا یادآوری وام
    isPaid: { type: Boolean, default: false }, // وضعیت پرداخت (مخصوص اقساط)
    
    date: { type: Date, default: Date.now }
}, { timestamps: true });

// برای سرعت بالای سرچ بر اساس کاربر و تاریخ
transactionSchema.index({ userId: 1, date: -1 });

module.exports = mongoose.model('Transaction', transactionSchema);

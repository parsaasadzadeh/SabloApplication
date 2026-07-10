const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    title: {
        type: String,
        required: true
    },
    message: {
        type: String,
        required: true
    },
    isRead: {
        type: Boolean,
        default: false
    }, // آیا کاربر پیام رو خونده؟

    // برای اینکه چک کنیم آیا قبلا برای این قسط پیام دادیم یا نه، آیدی قسط رو هم ذخیره می‌کنیم
    relatedTransactionId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Transaction',
        default: null
    },

    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('Notification', notificationSchema);

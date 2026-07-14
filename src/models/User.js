const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    phone: { type: String, required: true, unique: true },
    name: { type: String, default: "" },
    createdAt: { type: Date, default: Date.now },

    // توکن‌های پوش نوتیفیکیشن گوشی‌های این کاربر (ممکنه چند دستگاه داشته باشه)
    pushTokens: { type: [String], default: [] },
});

module.exports = mongoose.model('User', userSchema);

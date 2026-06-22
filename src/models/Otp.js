const mongoose = require('mongoose');

const otpSchema = new mongoose.Schema({
    phone: { type: String, required: true },
    code: { type: String, required: true },
    createdAt: { type: Date, default: Date.now, expires: 120 } // انقضا بعد از 120 ثانیه
});

module.exports = mongoose.model('Otp', otpSchema);
// models/Card.js
const mongoose = require('mongoose');

const cardSchema = new mongoose.Schema({
    userId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'User', 
        required: true 
    },
    name: { 
        type: String, 
        required: true,
        maxlength: 40
    },
    icon: { 
        type: String, 
        default: '💳'
    },
    color: { 
        type: String, 
        default: '#6C63FF' // رنگ پیش‌فرض
    },
    description: {
        type: String,
        default: ''
    }
}, { timestamps: true });

cardSchema.index({ userId: 1 });

module.exports = mongoose.model('Card', cardSchema);

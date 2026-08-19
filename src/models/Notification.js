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
    },
    relatedTransactionId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Transaction',
        default: null
    },
    reminderType: {
    type: String,
    enum: ['DUE_DATE', 'UPCOMING_DUE_DATE'], 
    default: null,
},
    createdAt: {
        type: Date,
        default: Date.now
    },
});

notificationSchema.index(
    { relatedTransactionId: 1, reminderType: 1 },
    { unique: true, sparse: true }
);

notificationSchema.index(
    { createdAt: 1 },
    { expireAfterSeconds: 20 * 24 * 60 * 60 }
);

module.exports = mongoose.models.Notification || mongoose.model('Notification', notificationSchema);

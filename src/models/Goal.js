const mongoose = require('mongoose');

const goalSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    title: {
        type: String,
        required: true
    },
    targetAmount: {
        type: Number,
        required: true
    },
    deadline: {
        type: Date,
        required: true
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

goalSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('Goal', goalSchema);

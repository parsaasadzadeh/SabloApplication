const mongoose = require('mongoose');

const pushTokenSchema = new mongoose.Schema({
    token: { type: String, required: true },
    platform: { type: String, enum: ['ios', 'android'], required: true },
    updatedAt: { type: Date, default: Date.now },
}, { _id: false });

const userSchema = new mongoose.Schema({
    phone: { type: String, required: true, unique: true },
    name: { type: String, default: "" },
    lastAiAnalysisAt: { type: Date, default: null },      
    lastAiAnalysisResult: { type: String, default: '' }, 
     pushTokens: { type: [pushTokenSchema], default: [] }, // ج
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', userSchema);

const mongoose = require('mongoose');


const userSchema = new mongoose.Schema({
    phone: { type: String, required: true, unique: true },
    name: { type: String, default: "" },
    currency: { 
        type: String, 
        enum: ['IRR', 'IRT'],
        default: 'IRT'
    },
    lastAiAnalysisAt: { type: Date, default: null },      
    lastAiAnalysisResult: { type: String, default: '' }, 
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', userSchema);

const mongoose = require('mongoose');


const userSchema = new mongoose.Schema({
    phone: { type: String, required: true, unique: true },
    name: { type: String, default: "" },
    lastAiAnalysisAt: { type: Date, default: null },      
    lastAiAnalysisResult: { type: String, default: '' }, 
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', userSchema);

const OpenAI = require('openai');
const User = require('../models/User');
const { calculateUserStats } = require('./financeController');

const client = new OpenAI({
    apiKey: process.env.GAPGPT_API_KEY,
    baseURL: 'https://api.gapgpt.app/v1'
});

exports.getAiAnalysis = async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        const now = new Date();
        const todayStr = now.toISOString().slice(0, 10);

        if (user.lastAiAnalysisAt) {
            const lastStr = user.lastAiAnalysisAt.toISOString().slice(0, 10);
            if (lastStr === todayStr) {
                return res.status(200).json({
                    cached: true,
                    message: 'شما امروز قبلاً از تحلیل هوش مصنوعی استفاده کرده‌اید',
                    analysis: user.lastAiAnalysisResult
                });
            }
        }

        const stats = await calculateUserStats(req.user.id);

        const prompt = `شما یک مشاور مالی هستید. بر اساس اطلاعات زیر یک تحلیل کوتاه و کاربردی (حداکثر 100 کلمه) به زبان فارسی بنویس، بدون مقدمه:
- موجودی خالص: ${stats.cashBalance} ریال
- کل درآمد: ${stats.totalIncome} ریال
- کل مخارج: ${stats.totalExpense} ریال
- بدهی باقی‌مانده: ${stats.activeDebt} ریال`;

        const response = await client.chat.completions.create({
            model: 'gapgpt-qwen-3.6',
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 400
        });

        const analysisText = response.choices[0].message.content;

        user.lastAiAnalysisAt = now;
        user.lastAiAnalysisResult = analysisText;
        await user.save();

        res.status(200).json({ cached: false, analysis: analysisText });
    } catch (error) {
        res.status(500).json({ message: 'خطا در دریافت تحلیل هوش مصنوعی', error: error.message });
    }
};

exports.getAiStatus = async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        const todayStr = new Date().toISOString().slice(0, 10);
        const usedToday = user.lastAiAnalysisAt &&
            user.lastAiAnalysisAt.toISOString().slice(0, 10) === todayStr;

        res.status(200).json({
            usedToday,
            lastResult: usedToday ? user.lastAiAnalysisResult : null
        });
    } catch (error) {
        res.status(500).json({ message: 'خطای سرور', error: error.message });
    }
};

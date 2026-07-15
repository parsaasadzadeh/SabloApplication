const OpenAI = require('openai');
const User = require('../models/User');
const { calculateUserStats } = require('./financeController');

const client = new OpenAI({
    apiKey: process.env.GAPGPT_API_KEY,
    baseURL: 'https://api.gapgpt.app/v1'
});

const toToman = (rial) => Math.round(rial / 10);

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

        const prompt = `شما یک مشاور مالی هستید. اعداد زیر بر حسب تومان است:
- موجودی خالص: ${toToman(stats.cashBalance)} تومان
- کل درآمد: ${toToman(stats.totalIncome)} تومان
- کل مخارج: ${toToman(stats.totalExpense)} تومان
- بدهی باقی‌مانده: ${toToman(stats.activeDebt)} تومان

یک تحلیل کوتاه و کاربردی حداکثر 50 کلمه به زبان فارسی بنویس، بدون مقدمه و بدون تکرار اعداد بالا در متن.`;

        const response = await client.chat.completions.create({
            model: 'gapgpt-qwen-3.6',
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 150
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

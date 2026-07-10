// مسیر: src/routes/cronRoutes.js

const express = require('express');
const router = express.Router();
const { checkInstallments } = require('../utils/checkInstallments');

// این آدرس رو فقط Vercel Cron صدا می‌زنه، نه کاربر عادی از فرانت
router.get('/check-installments', async (req, res) => {
    const authHeader = req.headers['authorization'];
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return res.status(401).json({ message: 'غیرمجاز' });
    }

    try {
        const result = await checkInstallments();
        res.status(200).json({ message: 'بررسی انجام شد', ...result });
    } catch (error) {
        res.status(500).json({ message: 'خطای سرور', error: error.message });
    }
});

module.exports = router;

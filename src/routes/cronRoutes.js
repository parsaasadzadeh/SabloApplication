const express = require('express');
const router = express.Router();
const {
    checkInstallments,
    checkInstallmentsOneDayBefore,
    checkInstallmentsTwoDaysBefore
} = require('../utils/checkInstallments');

router.get('/check-installments', async (req, res) => {
    const authHeader = req.headers['authorization'];
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return res.status(401).json({ message: 'غیرمجاز' });
    }

    try {
        const result = await checkInstallments();
        const result1Day = await checkInstallmentsOneDayBefore();
        const result2Days = await checkInstallmentsTwoDaysBefore();

        res.status(200).json({
            message: 'بررسی انجام شد',
            dueToday: result,
            oneDayBefore: result1Day,
            twoDaysBefore: result2Days
        });
    } catch (error) {
        res.status(500).json({ message: 'خطای سرور', error: error.message });
    }
});

module.exports = router;

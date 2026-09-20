const cron = require('node-cron');
const { checkInstallments, checkInstallmentsOneDayBefore, checkInstallmentsTwoDaysBefore } = require('./checkInstallments');

const startCronJobs = () => {
    cron.schedule('0 6 * * *', async () => {
        console.log('⏳ در حال بررسی اقساط...');
        try {
            const result = await checkInstallments();
            console.log(`✅ بررسی تمام شد: ${result.checked} قسط | ${result.notifCreated} اعلان`);

            const result1 = await checkInstallmentsOneDayBefore();
            console.log(`✅ یادآوری یک‌روز‌قبل: ${result1.checked} قسط | ${result1.notifCreated} اعلان`);

            const result2 = await checkInstallmentsTwoDaysBefore();
            console.log(`✅ یادآوری دو‌روز‌قبل: ${result2.checked} قسط | ${result2.notifCreated} اعلان`);
        } catch (err) {
            console.error('❌ خطای کلی در اجرای cron:', err.message);
        }
    });
};

module.exports = startCronJobs;

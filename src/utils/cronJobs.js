const cron = require('node-cron');
const { checkInstallments, checkInstallmentsOneDayBefore, checkInstallmentsTwoDaysBefore } = require('./checkInstallments');

const startCronJobs = () => {
    cron.schedule('0 6 * * *', async () => {
        console.log('⏳ در حال بررسی اقساط...');
        try {
            const result = await checkInstallments();
            console.log(
                `✅ بررسی تمام شد: ${result.checked} قسط | ${result.notifCreated} اعلان | ${result.smsSent} SMS ارسال شد | ${result.smsFailed} SMS ناموفق`
            );

            const result1 = await checkInstallmentsOneDayBefore();
            console.log(
                `✅ یادآوری یک‌روز‌قبل: ${result1.checked} قسط | ${result1.notifCreated} اعلان | ${result1.smsSent} SMS ارسال شد | ${result1.smsFailed} SMS ناموفق`
            );

            const result2 = await checkInstallmentsTwoDaysBefore();
            console.log(
                `✅ یادآوری دو‌روز‌قبل: ${result2.checked} قسط | ${result2.notifCreated} اعلان | ${result2.smsSent} SMS ارسال شد | ${result2.smsFailed} SMS ناموفق`
            );
        } catch (err) {
            console.error('❌ خطای کلی در اجرای cron:', err.message);
        }
    });
};

module.exports = startCronJobs;

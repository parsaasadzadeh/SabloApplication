const cron = require('node-cron');
const { checkInstallments } = require('./checkInstallments');

const startCronJobs = () => {
    cron.schedule('0 6 * * *', async () => {
        console.log('⏳ در حال بررسی اقساط نزدیک به سررسید...');
        try {
            const result = await checkInstallments();
            console.log(
                `✅ بررسی تمام شد: ${result.checked} قسط | ` +
                `${result.notifCreated} اعلان | ` +
                `${result.smsSent} SMS ارسال شد | ` +
                `${result.smsFailed} SMS ناموفق`
            );
        } catch (err) {
            console.error('❌ خطای کلی در اجرای cron سررسید:', err.message);
        }
    });
};

module.exports = startCronJobs;

// مسیر: src/utils/cronJobs.js

const cron = require('node-cron');
const { checkInstallments } = require('./checkInstallments');

const startCronJobs = () => {
    cron.schedule('0 6 * * *', async () => {
        console.log('⏳ در حال بررسی اقساط نزدیک به سررسید...');
        const result = await checkInstallments();
        console.log(`بررسی تمام شد: ${result.checked} قسط بررسی شد، ${result.created} اعلان ساخته شد.`);
    });
};

module.exports = startCronJobs;

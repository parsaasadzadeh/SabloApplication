const cron = require('node-cron');
const {
    checkInstallments,
    checkInstallmentsOneDayBefore,
    checkInstallmentsTwoDaysBefore,
} = require('./checkInstallments');

const startCronJobs = () => {
    // هر روز ساعت ۶ صبح UTC (۹:۳۰ به وقت ایران)
    cron.schedule('0 6 * * *', async () => {
        console.log('⏳ شروع بررسی اقساط...');
        try {
            const r0 = await checkInstallments();
            console.log(`✅ امروز: ${r0.checked} قسط | ${r0.notifCreated} اعلان`);

            const r1 = await checkInstallmentsOneDayBefore();
            console.log(`✅ فردا: ${r1.checked} قسط | ${r1.notifCreated} اعلان`);

            const r2 = await checkInstallmentsTwoDaysBefore();
            console.log(`✅ پس‌فردا: ${r2.checked} قسط | ${r2.notifCreated} اعلان`);
        } catch (err) {
            console.error('❌ خطا در کرون:', err.message);
        }
    });

    console.log('✅ کرون‌جاب اقساط فعال شد.');
};

module.exports = startCronJobs;

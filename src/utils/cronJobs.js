const cron = require('node-cron');
const Transaction = require('../models/Transaction');
const Notification = require('../models/Notification');
const startCronJobs = () => {
    cron.schedule('*/10 * * * * *', async () => {
        console.log('⏳ در حال بررسی اقساط نزدیک به سررسید...');

        try {
            const threeDaysFromNow = new Date();
            threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);

            const dueInstallments = await Transaction.find({
                type: 'INSTALLMENT',
                isPaid: false,
                dueDate: { $lte: threeDaysFromNow }
            });

            console.log(`تعداد اقساط پیدا شده: ${dueInstallments.length}`);

            for (let installment of dueInstallments) {

                const existingNotif = await Notification.findOne({
                    relatedTransactionId: installment._id
                });

                if (!existingNotif) {
                    await Notification.create({
                        userId: installment.userId,
                        title: 'یادآوری پرداخت قسط ⚠️',
                        message: `موعد پرداخت قسط شما به مبلغ ${installment.amount.toLocaleString()} تومان نزدیک است.`,
                        relatedTransactionId: installment._id
                    });

                    console.log(`✅ اعلان برای ${installment.userId} ساخته شد`);
                }
            }

        } catch (error) {
            console.error('❌ خطا:', error);
        }
    });
};= startCronJobs;

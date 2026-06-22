const cron = require('node-cron');
const Transaction = require('../models/Transaction');
const Notification = require('../models/Notification');

// این تابع هر روز ساعت 08:00 صبح اجرا میشه
const startCronJobs = () => {
    cron.schedule('0 6 * * *', async () => {
        console.log('⏳ در حال بررسی اقساط نزدیک به سررسید...');
        
        try {
            // پیدا کردن تاریخ 3 روز آینده
            const threeDaysFromNow = new Date();
            threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);

            // پیدا کردن تمام اقساطی که پرداخت نشدن و تاریخشون برای ۳ روز آینده یا کمتره
            const dueInstallments = await Transaction.find({
                type: 'INSTALLMENT',
                isPaid: false,
                dueDate: { $lte: threeDaysFromNow } // کوچکتر یا مساوی 3 روز دیگه
            });

            for (let installment of dueInstallments) {
                // چک می‌کنیم که آیا قبلاً برای این قسط پیام ساختیم که اسپم نشه؟
                const existingNotif = await Notification.findOne({ relatedTransactionId: installment._id });
                
                if (!existingNotif) {
                    // اگر پیامی نبود، یکی براش می‌سازیم
                    await Notification.create({
                        userId: installment.userId,
                        title: 'یادآوری پرداخت قسط ⚠️',
                        message: `کاربر عزیز، موعد پرداخت قسط شما به مبلغ ${installment.amount.toLocaleString()} تومان نزدیک است. لطفا نسبت به پرداخت آن اقدام کنید.`,
                        relatedTransactionId: installment._id
                    });
                    console.log(`✅ اعلان برای کاربر ${installment.userId} ثبت شد.`);
                }
            }
        } catch (error) {
            console.error('❌ خطا در سیستم یادآوری اقساط:', error);
        }
    });
};

module.exports = startCronJobs;
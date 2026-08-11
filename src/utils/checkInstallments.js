// src/utils/checkInstallments.js

const Transaction = require('../models/Transaction');
const Notification = require('../models/Notification');
const { sendInstallmentReminder } = require('./smsService');

async function checkInstallments() {
    const result = { checked: 0, notifCreated: 0, smsSent: 0, smsFailed: 0 };

    // بازه امروز بر اساس وقت سرور
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    console.log('📅 بازه جستجو:', todayStart.toISOString(), '←→', todayEnd.toISOString());

    const installments = await Transaction.find({
        type: 'INSTALLMENT',
        isPaid: false,
        dueDate: { $gte: todayStart, $lte: todayEnd },
    }).populate('userId', 'phone name');

    console.log(`🔍 تعداد اقساط امروز: ${installments.length}`);

    for (const installment of installments) {
        result.checked++;
        const user = installment.userId;

        if (!user) continue;

        // نوتیف داخل اپ
        try {
            await Notification.create({
                userId: user._id,
                title: 'امروز موعد پرداخت قسط شماست ⏰',
                message: `کاربر عزیز، امروز موعد پرداخت قسط «${installment.title}» به مبلغ ${installment.amount.toLocaleString()} تومان است.`,
                relatedTransactionId: installment._id,
                reminderType: 'DUE_DATE',
            });
            result.notifCreated++;
        } catch (error) {
            if (error.code !== 11000) {
                console.error(`❌ خطا در نوتیف:`, error.message);
            }
        }

        // SMS
        if (user.phone) {
            const smsResult = await sendInstallmentReminder(user.phone, installment.title);
            if (smsResult.success) {
                result.smsSent++;
                console.log(`📱 SMS رفت به ${user.phone}`);
            } else {
                result.smsFailed++;
                console.warn(`⚠️ SMS نرفت به ${user.phone}: ${smsResult.error}`);
            }
        }
    }

    return result;
}

module.exports = { checkInstallments };

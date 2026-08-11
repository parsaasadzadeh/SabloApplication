// src/utils/checkInstallments.js
const Transaction = require('../models/Transaction');
const Notification = require('../models/Notification');
const { sendInstallmentReminder } = require('./smsService');

async function checkInstallments() {
    const result = { checked: 0, notifCreated: 0, smsSent: 0, smsFailed: 0 };

    // ✅ وقت ایران (UTC+3:30)
    const iranOffsetMs = 3.5 * 60 * 60 * 1000;
    const nowIran = new Date(Date.now() + iranOffsetMs);

    const todayStart = new Date(nowIran);
    todayStart.setUTCHours(0, 0, 0, 0);

    const todayEnd = new Date(nowIran);
    todayEnd.setUTCHours(23, 59, 59, 999);

    const start = new Date(todayStart.getTime() - iranOffsetMs);
    const end = new Date(todayEnd.getTime() - iranOffsetMs);

    console.log('🕐 وقت ایران:', nowIran.toUTCString());
    console.log('📅 بازه جستجو:', start.toISOString(), '←→', end.toISOString());

    const installments = await Transaction.find({
        type: 'INSTALLMENT',
        isPaid: false,
        dueDate: { $gte: start, $lte: end },
    }).populate('userId', 'phone name');

    console.log(`🔍 تعداد اقساط امروز: ${installments.length}`);

    for (const installment of installments) {
        result.checked++;
        const user = installment.userId;

        if (!user) {
            console.warn(`⚠️ قسط ${installment._id} کاربر ندارد`);
            continue;
        }

        // ۱. نوتیف داخل اپ
        try {
            await Notification.create({
                userId: user._id,
                title: 'امروز موعد پرداخت قسط شماست ⏰',
                message: `کاربر عزیز، امروز موعد پرداخت قسط «${installment.title}» به مبلغ ${installment.amount.toLocaleString()} تومان است.`,
                relatedTransactionId: installment._id,
                reminderType: 'DUE_DATE',
            });
            result.notifCreated++;
            console.log(`✅ نوتیف برای ${user._id} ثبت شد`);
        } catch (error) {
            if (error.code !== 11000) {
                console.error(`❌ خطا در نوتیف:`, error.message);
            } else {
                console.log(`ℹ️ نوتیف قبلاً ثبت شده`);
            }
        }

        // ۲. SMS
        if (user.phone) {
            const smsResult = await sendInstallmentReminder(user.phone, installment.title);
            if (smsResult.success) {
                result.smsSent++;
                console.log(`📱 SMS رفت به ${user.phone}`);
            } else {
                result.smsFailed++;
                console.warn(`⚠️ SMS نرفت به ${user.phone}: ${smsResult.error}`);
            }
        } else {
            console.warn(`⚠️ کاربر ${user._id} شماره ندارد`);
        }
    }

    return result;
}

module.exports = { checkInstallments };

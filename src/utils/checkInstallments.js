// src/utils/checkInstallments.js
const Transaction = require('../models/Transaction');
const Notification = require('../models/Notification');
const { sendInstallmentReminder } = require('./smsService');

function startOfDay(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
}

function endOfDay(date) {
    const d = new Date(date);
    d.setHours(23, 59, 59, 999);
    return d;
}

async function checkInstallments() {
    const result = { checked: 0, notifCreated: 0, smsSent: 0, smsFailed: 0 };

    const today = new Date();
    const todayStart = startOfDay(today);
    const todayEnd = endOfDay(today);

    // ✅ فقط اقساطی که سررسیدشون دقیقاً امروزه — نه گذشته، نه آینده
    const installments = await Transaction.find({
        type: 'INSTALLMENT',
        isPaid: false,
        dueDate: { $gte: todayStart, $lte: todayEnd },
    }).populate('userId', 'phone name');

    for (const installment of installments) {
        result.checked++;
        const user = installment.userId;

        if (!user) {
            console.warn(`⚠️ قسط ${installment._id} userId ندارد، رد شد.`);
            continue;
        }

        // --- ۱. ساخت Notification ---
        try {
            await Notification.create({
                userId: user._id,
                title: 'امروز موعد پرداخت قسط شماست ⏰',
                message: `کاربر عزیز، امروز موعد پرداخت قسط «${installment.title}» به مبلغ ${installment.amount.toLocaleString()} تومان است.`,
                relatedTransactionId: installment._id,
                reminderType: 'DUE_DATE',
            });
            result.notifCreated++;
            console.log(`✅ اعلان سررسید برای کاربر ${user._id} ثبت شد.`);
        } catch (error) {
            if (error.code !== 11000) {
                console.error(`❌ خطا در ساخت اعلان قسط ${installment._id}:`, error.message);
            } else {
                console.log(`ℹ️ اعلان برای قسط ${installment._id} قبلاً ثبت شده، رد شد.`);
            }
        }

        // --- ۲. ارسال SMS ---
        if (user?.phone) {
            const smsResult = await sendInstallmentReminder(
                user.phone,
                installment.title
            );
            if (smsResult.success) {
                result.smsSent++;
                console.log(`📱 SMS سررسید برای ${user.phone} ارسال شد.`);
            } else {
                result.smsFailed++;
                console.warn(`⚠️ SMS برای ${user.phone} ارسال نشد: ${smsResult.error}`);
            }
        } else {
            console.warn(`⚠️ کاربر ${user._id} شماره تلفن ندارد، SMS ارسال نشد.`);
        }
    }

    return result;
}

module.exports = { checkInstallments };

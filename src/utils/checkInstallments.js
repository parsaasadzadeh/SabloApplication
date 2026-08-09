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
function addDays(date, days) {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
}

async function processRange(rangeStart, rangeEnd, reminderType, buildContent, result) {
    const installments = await Transaction.find({
        type: 'INSTALLMENT',
        isPaid: false,
        dueDate: { $gte: rangeStart, $lte: rangeEnd }, // ✅ فقط همون بازه، نه هر چی قبل‌تره
    }).populate('userId', 'phone name');

    for (const installment of installments) {
        result.checked++;
        const user = installment.userId;
        const { title, message } = buildContent(installment);

        try {
            await Notification.create({
                userId: user._id,
                title,
                message,
                relatedTransactionId: installment._id,
                reminderType, // 'DAY_BEFORE' یا 'DUE_DATE'
            });
            result.notifCreated++;
        } catch (error) {
            if (error.code !== 11000) {
                console.error(`❌ خطا در ساخت اعلان قسط ${installment._id}:`, error.message);
            }
        }

        if (user?.phone) {
            const smsResult = await sendInstallmentReminder(user.phone, installment.title, reminderType);
            if (smsResult.success) {
                result.smsSent++;
                console.log(`📱 SMS (${reminderType}) برای ${user.phone} ارسال شد.`);
            } else {
                result.smsFailed++;
                console.warn(`⚠️ SMS برای ${user.phone} ارسال نشد: ${smsResult.error}`);
            }
        } else {
            console.warn(`⚠️ کاربر ${user._id} شماره تلفن ندارد، SMS ارسال نشد.`);
        }
    }
}

async function checkInstallments() {
    const result = { checked: 0, notifCreated: 0, smsSent: 0, smsFailed: 0 };
    const today = new Date();
    const tomorrow = addDays(today, 1);

    // یک روز مونده به سررسید
    await processRange(
        startOfDay(tomorrow),
        endOfDay(tomorrow),
        'DAY_BEFORE',
        (installment) => ({
            title: 'فردا موعد پرداخت قسط شماست ⏰',
            message: `کاربر عزیز، فردا موعد پرداخت قسط «${installment.title}» به مبلغ ${installment.amount.toLocaleString()} تومان است.`,
        }),
        result
    );

    // امروز سررسید
    await processRange(
        startOfDay(today),
        endOfDay(today),
        'DUE_DATE',
        (installment) => ({
            title: 'امروز موعد پرداخت قسط شماست ⏰',
            message: `کاربر عزیز، امروز موعد پرداخت قسط «${installment.title}» به مبلغ ${installment.amount.toLocaleString()} تومان است.`,
        }),
        result
    );

    return result;
}

module.exports = { checkInstallments };

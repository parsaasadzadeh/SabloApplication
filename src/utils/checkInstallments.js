// مسیر: src/utils/checkInstallments.js

const Transaction = require('../models/Transaction');
const Notification = require('../models/Notification');

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// تاریخ رو به نیمه‌شب می‌بریم تا فقط «روز» مقایسه بشه، نه ساعت دقیق
function startOfDay(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
}

function daysUntil(dueDate) {
    const today = startOfDay(new Date());
    const due = startOfDay(dueDate);
    return Math.round((due - today) / MS_PER_DAY);
}

const REMINDERS = [
    { daysLeft: 3, type: '3_DAYS_BEFORE', title: 'یادآوری پرداخت قسط ⚠️' },
    { daysLeft: 2, type: '2_DAYS_BEFORE', title: 'یادآوری پرداخت قسط ⚠️' },
    { daysLeft: 0, type: 'DUE_DATE', title: 'امروز موعد پرداخت قسط شماست ⏰' },
];

async function checkInstallments() {
    const result = { checked: 0, created: 0 };

    const upperBound = new Date();
    upperBound.setDate(upperBound.getDate() + 3);
    upperBound.setHours(23, 59, 59, 999);

    const installments = await Transaction.find({
        type: 'INSTALLMENT',
        isPaid: false,
        dueDate: { $lte: upperBound },
    });

    for (const installment of installments) {
        result.checked++;
        const diff = daysUntil(installment.dueDate);
        const reminder = REMINDERS.find((r) => r.daysLeft === diff);
        if (!reminder) continue;

        try {
            await Notification.create({
                userId: installment.userId,
                title: reminder.title,
                message: `کاربر عزیز، ${
                    reminder.daysLeft === 0 ? 'امروز' : `${reminder.daysLeft} روز دیگر`
                } موعد پرداخت قسط شما به مبلغ ${installment.amount.toLocaleString()} تومان است.`,
                relatedTransactionId: installment._id,
                reminderType: reminder.type,
            });
            result.created++;
            console.log(`✅ اعلان (${reminder.type}) برای کاربر ${installment.userId} ثبت شد.`);
        } catch (error) {
            if (error.code !== 11000) {
                console.error(`❌ خطا در ساخت اعلان قسط ${installment._id}:`, error.message);
            }
        }
    }

    return result;
}

module.exports = { checkInstallments };

// src/utils/checkInstallments.js
const Transaction = require('../models/Transaction');
const Notification = require('../models/Notification');
const User         = require('../models/User');
const { sendPushNotifications } = require('./pushService');

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function startOfDay(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
}
function daysUntil(dueDate) {
    const today = startOfDay(new Date());
    const due   = startOfDay(dueDate);
    return Math.round((due - today) / MS_PER_DAY);
}

const REMINDERS = [
    { daysLeft: 3, type: '3_DAYS_BEFORE', title: 'یادآوری پرداخت قسط ⚠️' },
    { daysLeft: 2, type: '2_DAYS_BEFORE', title: 'یادآوری پرداخت قسط ⚠️' },
    { daysLeft: 1, type: '1_DAY_BEFORE',  title: 'یادآوری پرداخت قسط ⚠️' },
    { daysLeft: 0, type: 'DUE_DATE',       title: 'امروز موعد پرداخت قسط شماست ⏰' },
];

async function checkInstallments() {
    const result = { checked: 0, created: 0, pushed: 0 };

    const upperBound = new Date();
    upperBound.setDate(upperBound.getDate() + 3);
    upperBound.setHours(23, 59, 59, 999);

    const installments = await Transaction.find({
        type:    'INSTALLMENT',
        isPaid:  false,
        dueDate: { $lte: upperBound },
    });

    const pushMessages = [];

    for (const installment of installments) {
        result.checked++;
        const diff     = daysUntil(installment.dueDate);
        const reminder = REMINDERS.find(r => r.daysLeft === diff);
        if (!reminder) continue;

        try {
            const body = `${diff === 0 ? 'امروز' : `${diff} روز دیگر`} موعد پرداخت قسط «${installment.title}» به مبلغ ${installment.amount.toLocaleString()} تومان است.`;

            await Notification.create({
                userId:               installment.userId,
                title:                reminder.title,
                message:              `کاربر عزیز، ${body}`,
                relatedTransactionId: installment._id,
                reminderType:         reminder.type,
            });
            result.created++;

            // پیدا کردن pushToken کاربر
            const user = await User.findById(installment.userId).select('pushToken');
            if (user?.pushToken) {
                pushMessages.push({
                    token: user.pushToken,
                    title: reminder.title,
                    body,
                    data: { transactionId: installment._id.toString(), type: 'INSTALLMENT_REMINDER' },
                });
            }
        } catch (error) {
            if (error.code !== 11000) {
                console.error(`❌ خطا:`, error.message);
            }
        }
    }

    // ارسال همه push ها یکجا (بهینه)
    if (pushMessages.length > 0) {
        await sendPushNotifications(pushMessages);
        result.pushed = pushMessages.length;
        console.log(`📲 ${result.pushed} push notification ارسال شد.`);
    }

    return result;
}

module.exports = { checkInstallments };

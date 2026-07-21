// src/utils/checkInstallments.js
const Transaction = require('../models/Transaction');
const Notification = require('../models/Notification');
const User = require('../models/User');
const { sendExpoPush } = require('./pushService'); // 👈 اضافه شد

const MS_PER_DAY = 24 * 60 * 60 * 1000;

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
    { daysLeft: 1, type: '1_DAY_BEFORE', title: 'یادآوری پرداخت قسط ⚠️' },
    { daysLeft: 0, type: 'DUE_DATE',      title: 'امروز موعد پرداخت قسط شماست ⏰' },
];

async function checkInstallments() {
    const result = { checked: 0, created: 0, pushed: 0 };

    const upperBound = new Date();
    upperBound.setDate(upperBound.getDate() + 3);
    upperBound.setHours(23, 59, 59, 999);

    const installments = await Transaction.find({
        type: 'INSTALLMENT',
        isPaid: false,
        dueDate: { $lte: upperBound },
    });

    // یه بار همه userهای مربوطه رو بگیر (به جای N تا query)
    const userIds = [...new Set(installments.map(i => i.userId.toString()))];
    const users = await User.find({ _id: { $in: userIds } }).select('_id expoPushToken');
    const userMap = {};
    users.forEach(u => { userMap[u._id.toString()] = u.expoPushToken; });

    for (const installment of installments) {
        result.checked++;
        const diff = daysUntil(installment.dueDate);
        const reminder = REMINDERS.find((r) => r.daysLeft === diff);
        if (!reminder) continue;

        const messageText = `کاربر عزیز، ${
            reminder.daysLeft === 0 ? 'امروز' : `${reminder.daysLeft} روز دیگر`
        } موعد پرداخت قسط «${installment.title}» به مبلغ ${installment.amount.toLocaleString()} تومان است.`;

        try {
            await Notification.create({
                userId: installment.userId,
                title: reminder.title,
                message: messageText,
                relatedTransactionId: installment._id,
                reminderType: reminder.type,
            });
            result.created++;

            // 👇 بعد از ذخیره در DB، push بفرست
            const pushToken = userMap[installment.userId.toString()];
            if (pushToken) {
                await sendExpoPush(pushToken, reminder.title, messageText);
                result.pushed++;
            }

            console.log(`✅ اعلان (${reminder.type}) برای کاربر ${installment.userId} ثبت و ارسال شد.`);
        } catch (error) {
            if (error.code !== 11000) {
                console.error(`❌ خطا در قسط ${installment._id}:`, error.message);
            }
        }
    }

    return result;
}

module.exports = { checkInstallments };

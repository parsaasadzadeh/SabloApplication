// src/utils/checkInstallments.js

const Transaction = require('../models/Transaction');
const Notification = require('../models/Notification');
const { sendInstallmentReminder } = require('./smsService');

function getTodayRangeIran() {
    const iranOffsetMs = 3.5 * 60 * 60 * 1000; 
    const nowUtc = Date.now();
    const nowIran = new Date(nowUtc + iranOffsetMs);

    const startIran = new Date(nowIran);
    startIran.setUTCHours(0, 0, 0, 0);

    const endIran = new Date(nowIran);
    endIran.setUTCHours(23, 59, 59, 999);
    return {
        start: new Date(startIran.getTime() - iranOffsetMs),
        end: new Date(endIran.getTime() - iranOffsetMs),
    };
}

async function checkInstallments() {
    const result = { checked: 0, notifCreated: 0, smsSent: 0, smsFailed: 0 };

    const { start, end } = getTodayRangeIran();
    
    console.log('📅 بازه جستجو:', start.toISOString(), '←→', end.toISOString());

    const installments = await Transaction.find({
        type: 'INSTALLMENT',
        isPaid: false,
        dueDate: { $gte: start, $lte: end },
    }).populate('userId', 'phone name');

    console.log(`🔍 تعداد اقساط پیدا شده: ${installments.length}`);

    for (const installment of installments) {
        result.checked++;
        const user = installment.userId;

        if (!user) {
            console.warn(`⚠️ قسط ${installment._id} userId ندارد`);
            continue;
        }

        try {
            await Notification.create({
                userId: user._id,
                title: 'امروز موعد پرداخت قسط شماست ⏰',
                message: `کاربر عزیز، امروز موعد پرداخت قسط «${installment.title}» به مبلغ ${installment.amount.toLocaleString()} تومان است.`,
                relatedTransactionId: installment._id,
                reminderType: 'DUE_DATE',
            });
            result.notifCreated++;
            console.log(`✅ اعلان برای کاربر ${user._id} ثبت شد.`);
        } catch (error) {
            if (error.code !== 11000) {
                console.error(`❌ خطا در ساخت اعلان:`, error.message);
            } else {
                console.log(`ℹ️ اعلان قبلاً ثبت شده، رد شد.`);
            }
        }

        // ارسال SMS
        if (user?.phone) {
            const smsResult = await sendInstallmentReminder(user.phone, installment.title);
            if (smsResult.success) {
                result.smsSent++;
            } else {
                result.smsFailed++;
                console.warn(`⚠️ SMS ناموفق برای ${user.phone}: ${smsResult.error}`);
            }
        }
    }

    return result;
}

module.exports = { checkInstallments };

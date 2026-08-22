const Transaction = require('../models/Transaction');
const Notification = require('../models/Notification');
const { sendInstallmentReminder, sendUpcomingReminder } = require('./smsService');

const DAYS_BEFORE_DUE = 1;

function getDayRangeUTC(offsetDays = 0) {
    const now = new Date();
    const start = new Date(Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() + offsetDays,
        0, 0, 0, 0
    ));
    const end = new Date(Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() + offsetDays,
        23, 59, 59, 999
    ));
    return { start, end };
}

async function processReminderBatch({ offsetDays, reminderType, buildTexts, smsSender }) {
    const batchResult = { checked: 0, notifCreated: 0, smsSent: 0, smsFailed: 0 };
    const { start, end } = getDayRangeUTC(offsetDays);

    console.log(`📅 بازه جستجو [${reminderType}] (UTC):`, start.toISOString(), '←→', end.toISOString());

    const installments = await Transaction.find({
        type: 'INSTALLMENT',
        isPaid: false,
        dueDate: { $gte: start, $lte: end },
    }).populate('userId', 'phone name');

    console.log(`🔍 تعداد اقساط [${reminderType}]: ${installments.length}`);

    for (const installment of installments) {
        batchResult.checked++;
        const user = installment.userId;

        if (!user || !user._id) {
            console.warn(`⚠️ قسط ${installment._id} کاربر معتبر نداره، رد شد.`);
            continue;
        }

        const { notifTitle, notifMessage } = buildTexts(installment);

        // --- ۱. نوتیف داخل اپ ---
        try {
            await Notification.create({
                userId: user._id,
                title: notifTitle,
                message: notifMessage,
                relatedTransactionId: installment._id,
                reminderType,
            });
            batchResult.notifCreated++;
            console.log(`✅ نوتیف [${reminderType}] برای کاربر ${user._id} ثبت شد.`);
        } catch (error) {
            if (error.code !== 11000) {
                console.error(`❌ خطا در ساخت نوتیف قسط ${installment._id}:`, error.message);
            } else {
                console.log(`ℹ️ نوتیف [${reminderType}] قبلاً ثبت شده بود، skip شد.`);
            }
        }

        // --- ۲. ارسال SMS با تابع مناسب ---
        if (user.phone) {
            const smsResult = await smsSender(user.phone, installment.title);
            if (smsResult.success) {
                batchResult.smsSent++;
                console.log(`📱 SMS [${reminderType}] رفت به ${user.phone}`);
            } else {
                batchResult.smsFailed++;
                console.warn(`⚠️ SMS [${reminderType}] نرفت به ${user.phone}: ${smsResult.error}`);
            }
        } else {
            console.warn(`⚠️ کاربر ${user._id} شماره نداره، SMS ارسال نشد.`);
        }
    }

    return batchResult;
}

function mergeResults(...results) {
    return results.reduce((acc, r) => ({
        checked: acc.checked + r.checked,
        notifCreated: acc.notifCreated + r.notifCreated,
        smsSent: acc.smsSent + r.smsSent,
        smsFailed: acc.smsFailed + r.smsFailed,
    }), { checked: 0, notifCreated: 0, smsSent: 0, smsFailed: 0 });
}

async function checkInstallments() {
    // ✅ یادآوری یک روز قبل — template «فردا»
    const upcomingResult = await processReminderBatch({
        offsetDays: DAYS_BEFORE_DUE,
        reminderType: 'UPCOMING_DUE_DATE',
        smsSender: sendUpcomingReminder, // ✅ template فردا
        buildTexts: (installment) => ({
            notifTitle: 'یادآوری سررسید قسط ⏳',
            notifMessage: `کاربر عزیز، فردا موعد پرداخت قسط «${installment.title}» به مبلغ ${installment.amount.toLocaleString()} تومان است.`,
        }),
    });

    // ✅ یادآوری روز سررسید — template «امروز»
    const dueTodayResult = await processReminderBatch({
        offsetDays: 0,
        reminderType: 'DUE_DATE',
        smsSender: sendInstallmentReminder, // ✅ template امروز
        buildTexts: (installment) => ({
            notifTitle: 'امروز موعد پرداخت قسط شماست ⏰',
            notifMessage: `کاربر عزیز، امروز موعد پرداخت قسط «${installment.title}» به مبلغ ${installment.amount.toLocaleString()} تومان است.`,
        }),
    });

    const result = mergeResults(upcomingResult, dueTodayResult);
    result.upcoming = upcomingResult;
    result.dueToday = dueTodayResult;

    return result;
}

module.exports = { checkInstallments };

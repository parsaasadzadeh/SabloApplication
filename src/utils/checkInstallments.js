const Transaction = require('../models/Transaction');
const Notification = require('../models/Notification');

const REMINDER_TYPE = 'DUE_DATE';

function getTodayRangeUTC() {
    const now = new Date();
    const start = new Date(Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate(),
        0, 0, 0, 0
    ));
    const end = new Date(Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate(),
        23, 59, 59, 999
    ));
    return { start, end };
}

async function checkInstallments() {
    const result = { checked: 0, notifCreated: 0 };
    const { start, end } = getTodayRangeUTC();

    console.log(`📅 بازه جستجو [${REMINDER_TYPE}] (UTC):`, start.toISOString(), '←→', end.toISOString());

    const installments = await Transaction.find({
        type: 'INSTALLMENT',
        isPaid: false,
        dueDate: { $gte: start, $lte: end },
    }).populate('userId', 'name');

    console.log(`🔍 تعداد اقساط [${REMINDER_TYPE}]: ${installments.length}`);

    for (const installment of installments) {
        result.checked++;
        const user = installment.userId;

        if (!user || !user._id) {
            console.warn(`⚠️ قسط ${installment._id} کاربر معتبر نداره، رد شد.`);
            continue;
        }

        const notifTitle = 'امروز موعد پرداخت قسط شماست ⏰';
        const notifMessage = `کاربر عزیز، امروز موعد پرداخت قسط «${installment.title}» به مبلغ ${installment.amount.toLocaleString()} تومان است.`;

        // نوتیف داخل اپ
        try {
            await Notification.create({
                userId: user._id,
                title: notifTitle,
                message: notifMessage,
                relatedTransactionId: installment._id,
                reminderType: REMINDER_TYPE,
            });
            result.notifCreated++;
            console.log(`✅ نوتیف [${REMINDER_TYPE}] برای کاربر ${user._id} ثبت شد.`);
        } catch (error) {
            if (error.code !== 11000) {
                console.error(`❌ خطا در ساخت نوتیف قسط ${installment._id}:`, error.message);
            } else {
                console.log(`ℹ️ نوتیف [${REMINDER_TYPE}] قبلاً ثبت شده بود، skip شد.`);
            }
        }
    }

    return result;
}

// ============================================
// یک روز و دو روز قبل
// ============================================

function getOffsetDayRangeUTC(offsetDays) {
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

async function checkInstallmentsByOffset(offsetDays, reminderType, notifTitle, buildMessage) {
    const result = { checked: 0, notifCreated: 0 };
    const { start, end } = getOffsetDayRangeUTC(offsetDays);

    console.log(`📅 بازه جستجو [${reminderType}] (UTC):`, start.toISOString(), '←→', end.toISOString());

    const installments = await Transaction.find({
        type: 'INSTALLMENT',
        isPaid: false,
        dueDate: { $gte: start, $lte: end },
    }).populate('userId', 'name');

    console.log(`🔍 تعداد اقساط [${reminderType}]: ${installments.length}`);

    for (const installment of installments) {
        result.checked++;
        const user = installment.userId;

        if (!user || !user._id) {
            console.warn(`⚠️ قسط ${installment._id} کاربر معتبر نداره، رد شد.`);
            continue;
        }

        const notifMessage = buildMessage(installment);

        // نوتیف داخل اپ
        try {
            await Notification.create({
                userId: user._id,
                title: notifTitle,
                message: notifMessage,
                relatedTransactionId: installment._id,
                reminderType,
            });
            result.notifCreated++;
            console.log(`✅ نوتیف [${reminderType}] برای کاربر ${user._id} ثبت شد.`);
        } catch (error) {
            if (error.code !== 11000) {
                console.error(`❌ خطا در ساخت نوتیف قسط ${installment._id}:`, error.message);
            } else {
                console.log(`ℹ️ نوتیف [${reminderType}] قبلاً ثبت شده بود، skip شد.`);
            }
        }
    }

    return result;
}

async function checkInstallmentsOneDayBefore() {
    return checkInstallmentsByOffset(
        1,
        'DUE_DATE_1DAY',
        'فردا موعد پرداخت قسط شماست ⏰',
        (installment) => `کاربر عزیز، فردا موعد پرداخت قسط «${installment.title}» به مبلغ ${installment.amount.toLocaleString()} تومان است.`
    );
}

async function checkInstallmentsTwoDaysBefore() {
    return checkInstallmentsByOffset(
        2,
        'DUE_DATE_2DAYS',
        '۲ روز دیگر موعد پرداخت قسط شماست ⏰',
        (installment) => `کاربر عزیز، ۲ روز دیگر موعد پرداخت قسط «${installment.title}» به مبلغ ${installment.amount.toLocaleString()} تومان است.`
    );
}

module.exports = { checkInstallments, checkInstallmentsOneDayBefore, checkInstallmentsTwoDaysBefore };

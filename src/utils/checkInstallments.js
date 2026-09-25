const Transaction = require('../models/Transaction');
const Notification = require('../models/Notification');

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

async function processInstallments(offsetDays, reminderType, buildTitle, buildMessage) {
    const { start, end } = getDayRangeUTC(offsetDays);

    const installments = await Transaction.find({
        type: 'INSTALLMENT',
        isPaid: false,
        dueDate: { $gte: start, $lte: end },
    }).populate('userId', 'name');

    console.log(`🔍 [${reminderType}] تعداد اقساط: ${installments.length}`);

    let notifCreated = 0;

    for (const installment of installments) {
        const user = installment.userId;
        if (!user?._id) {
            console.warn(`⚠️ قسط ${installment._id} کاربر ندارد، رد شد.`);
            continue;
        }

        try {
            await Notification.create({
                userId: user._id,
                title: buildTitle(),
                message: buildMessage(installment),
                relatedTransactionId: installment._id,
                reminderType,
            });
            notifCreated++;
            console.log(`✅ [${reminderType}] نوتیف برای کاربر ${user._id} ثبت شد.`);
        } catch (err) {
            if (err.code === 11000) {
                console.log(`ℹ️ [${reminderType}] نوتیف قبلاً ثبت شده بود.`);
            } else {
                console.error(`❌ [${reminderType}] خطا:`, err.message);
            }
        }
    }

    return { checked: installments.length, notifCreated };
}

// امروز
function checkInstallments() {
    return processInstallments(
        0,
        'DUE_DATE',
        () => 'امروز موعد پرداخت قسط شماست ⏰',
        (i) => `امروز موعد پرداخت قسط «${i.title}» به مبلغ ${i.amount.toLocaleString()} تومان است.`
    );
}

// یک روز قبل
function checkInstallmentsOneDayBefore() {
    return processInstallments(
        1,
        'DUE_DATE_1DAY',
        () => 'فردا موعد پرداخت قسط شماست ⏰',
        (i) => `فردا موعد پرداخت قسط «${i.title}» به مبلغ ${i.amount.toLocaleString()} تومان است.`
    );
}

// دو روز قبل
function checkInstallmentsTwoDaysBefore() {
    return processInstallments(
        2,
        'DUE_DATE_2DAYS',
        () => '۲ روز دیگر موعد پرداخت قسط شماست ⏰',
        (i) => `۲ روز دیگر موعد پرداخت قسط «${i.title}» به مبلغ ${i.amount.toLocaleString()} تومان است.`
    );
}

module.exports = {
    checkInstallments,
    checkInstallmentsOneDayBefore,
    checkInstallmentsTwoDaysBefore,
};

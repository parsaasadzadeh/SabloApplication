// src/utils/checkInstallments.js

const Transaction = require('../models/Transaction');
const Notification = require('../models/Notification');
const { sendInstallmentReminder } = require('./smsService');

async function checkInstallments() {
    const result = { checked: 0, notifCreated: 0, smsSent: 0, smsFailed: 0 };

    // ✅ بازه امروز بر اساس UTC (چون MongoDB همه چیز رو UTC ذخیره میکنه)
    const now = new Date();
    const todayStart = new Date(Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate(),
        0, 0, 0, 0
    ));
    const todayEnd = new Date(Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate(),
        23, 59, 59, 999
    ));

    console.log('📅 بازه جستجو (UTC):', todayStart.toISOString(), '←→', todayEnd.toISOString());

    const installments = await Transaction.find({
        type: 'INSTALLMENT',
        isPaid: false,
        dueDate: { $gte: todayStart, $lte: todayEnd }, // ✅ فقط امروز
    }).populate('userId', 'phone name');

    console.log(`🔍 تعداد اقساط امروز: ${installments.length}`);

    for (const installment of installments) {
        result.checked++;
        const user = installment.userId;

        // اگه populate درست کار نکرده باشه skip کن
        if (!user || !user._id) {
            console.warn(`⚠️ قسط ${installment._id} کاربر معتبر نداره، رد شد.`);
            continue;
        }

        // --- ۱. نوتیف داخل اپ ---
        try {
            await Notification.create({
                userId: user._id,
                title: 'امروز موعد پرداخت قسط شماست ⏰',
                message: `کاربر عزیز، امروز موعد پرداخت قسط «${installment.title}» به مبلغ ${installment.amount.toLocaleString()} تومان است.`,
                relatedTransactionId: installment._id,
                reminderType: 'DUE_DATE',
            });
            result.notifCreated++;
            console.log(`✅ نوتیف برای کاربر ${user._id} ثبت شد.`);
        } catch (error) {
            // کد 11000 یعنی duplicate — نوتیف قبلاً ساخته شده، نرماله
            if (error.code !== 11000) {
                console.error(`❌ خطا در ساخت نوتیف قسط ${installment._id}:`, error.message);
            }
        }

        // --- ۲. ارسال SMS ---
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
            console.warn(`⚠️ کاربر ${user._id} شماره نداره، SMS ارسال نشد.`);
        }
    }

    return result;
}

module.exports = { checkInstallments };

const Transaction = require('../models/Transaction');
const Notification = require('../models/Notification');

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
  const result = { checked: 0, created: 0 };

  const todayEnd = endOfDay(new Date());

  // نکته: به‌جای gte/lte دقیقاً روی «امروز»، از lte استفاده می‌کنیم
  // تا اگر یک روز کرون به هر دلیلی اجرا نشد (سرور داون بود و غیره)،
  // قسط عقب‌افتاده روز بعد هم پوشش داده بشه و کاربر جا نمونه
  const installments = await Transaction.find({
    type: 'INSTALLMENT',
    isPaid: false,
    dueDate: { $lte: todayEnd },
  });

  for (const installment of installments) {
    result.checked++;

    try {
      await Notification.create({
        userId: installment.userId,
        title: 'امروز موعد پرداخت قسط شماست ⏰',
        message: `کاربر عزیز، امروز موعد پرداخت قسط «${installment.title}» به مبلغ ${installment.amount.toLocaleString()} تومان است.`,
        relatedTransactionId: installment._id,
        reminderType: 'DUE_DATE',
      });

      result.created++;
      console.log(`✅ اعلان سررسید برای کاربر ${installment.userId} ثبت شد.`);
    } catch (error) {
      if (error.code !== 11000) {
        console.error(`❌ خطا در ساخت اعلان قسط ${installment._id}:`, error.message);
      }
    }
  }

  return result;
}

module.exports = { checkInstallments };

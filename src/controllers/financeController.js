const Transaction = require('../models/Transaction');
const mongoose = require('mongoose');

// ۱. ثبت تراکنش جدید (با پشتیبانی از اتصال قسط به وام)
exports.addTransaction = async (req, res) => {
    try {
        const { type, amount, title, description, dueDate, loanId } = req.body; // ❌ category حذف شد

        if (amount <= 0) {
            return res.status(400).json({ message: 'مبلغ باید بیشتر از صفر باشد' });
        }

        const newTx = await Transaction.create({
            userId: req.user.id,
            type,
            amount,
            title,
            description,
            dueDate,
            loanId: loanId ? new mongoose.Types.ObjectId(loanId) : null,
            isPaid: type === 'LOAN' || type === 'INCOME' || type === 'EXPENSE' ? true : false
        });
        
        res.status(201).json({ message: 'تراکنش با موفقیت ثبت شد', transaction: newTx });
    } catch (error) {
        res.status(500).json({ message: 'خطای سرور', error: error.message });
    }
};

// ۲. دریافت لیست تراکنش‌ها به صورت صفحه‌بندی شده (جلوگیری از کندی سرور)
exports.getMyTransactions = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;

        const transactions = await Transaction.find({ userId: req.user.id })
            .sort({ date: -1 })
            .skip(skip)
            .limit(limit);

        const totalTransactions = await Transaction.countDocuments({ userId: req.user.id });

        res.status(200).json({ 
            currentPage: page,
            totalPages: Math.ceil(totalTransactions / limit),
            totalItems: totalTransactions,
            transactions 
        });
    } catch (error) {
        res.status(500).json({ message: 'خطای سرور', error: error.message });
    }
};

// ۳. مغز سیستم: محاسبات آماری دقیق و پیشرفته با Aggregation MongoDB
exports.getFinanceStats = async (req, res) => {
    try {
        const userId = new mongoose.Types.ObjectId(req.user.id);

        const stats = await Transaction.aggregate([
            { $match: { userId: userId } },
            {
                $facet: {
                    // بخش اول: محاسبه مجموع دریافتی‌ها و مخارج بر اساس نوع تراکنش
                    // ⚠️ نکته مهم: برای نوع INSTALLMENT فقط مقادیری که isPaid=true هستن جمع زده می‌شن
                    // در غیر این صورت قسط‌های پرداخت‌نشده هم از موجودی کم می‌شدن (باگ قبلی)
                    "totals": [
                        {
                            $group: {
                                _id: "$type",
                                totalAmount: {
                                    $sum: {
                                        $cond: [
                                            { $eq: ["$type", "INSTALLMENT"] },
                                            { $cond: ["$isPaid", "$amount", 0] },
                                            "$amount"
                                        ]
                                    }
                                }
                            }
                        }
                    ],
                    // بخش دوم: وضعیت اقساط پرداخت نشده
                    "unpaidInstallments": [
                        { $match: { type: "INSTALLMENT", isPaid: false } },
                        {
                            $group: {
                                _id: null,
                                totalRemaining: { $sum: "$amount" },
                                count: { $sum: 1 }
                            }
                        }
                    ]
                    // ❌ فacet "expenseCategories" حذف شد چون دیگه category نداریم
                }
            }
        ]);

        const rawTotals = stats[0].totals;
        const unpaidInstallmentsData = stats[0].unpaidInstallments[0] || { totalRemaining: 0, count: 0 };

        let income = 0, expense = 0, loans = 0, installmentsPaid = 0;

        rawTotals.forEach(item => {
            if (item._id === 'INCOME') income = item.totalAmount;
            if (item._id === 'EXPENSE') expense = item.totalAmount;
            if (item._id === 'LOAN') loans = item.totalAmount;
            if (item._id === 'INSTALLMENT') installmentsPaid = item.totalAmount; // فقط اقساط پرداخت‌شده
        });

        // فرمول‌های استاندارد حسابداری:
        // موجودی نقدی = (درآمدها + وام‌های گرفته شده) - (مخارج عادی + اقساط *پرداخت‌شده*)
        const cashBalance = (income + loans) - (expense + installmentsPaid);
        
        // کل بدهی فعلی کاربر = وام‌های دریافتی - اقساطی که تا الان واقعاً پرداخت کرده
        const activeDebt = loans - installmentsPaid;

        res.status(200).json({
            summary: {
                cashBalance,
                totalIncome: income,
                totalExpense: expense,
                activeDebt,
                unpaidInstallmentsCount: unpaidInstallmentsData.count,
                unpaidInstallmentsAmount: unpaidInstallmentsData.totalRemaining
            }
        });

    } catch (error) {
        res.status(500).json({ message: 'خطای سرور', error: error.message });
    }
};

// ۴. تغییر وضعیت قسط به پرداخت‌شده
exports.payInstallment = async (req, res) => {
    try {
        const installmentId = req.params.id;

        const updatedInstallment = await Transaction.findOneAndUpdate(
            { _id: installmentId, userId: req.user.id, type: 'INSTALLMENT' },
            { isPaid: true, date: Date.now() },
            { new: true }
        );

        if (!updatedInstallment) {
            return res.status(404).json({ message: 'قسط مورد نظر یافت نشد' });
        }

        res.status(200).json({ message: 'قسط با موفقیت پرداخت شد', installment: updatedInstallment });
    } catch (error) {
        res.status(500).json({ message: 'خطای سرور', error: error.message });
    }
};

// ۵. ویرایش تراکنش (عنوان، مبلغ، توضیحات، تاریخ سررسید)
exports.updateTransaction = async (req, res) => {
    try {
        const { id } = req.params;
        const { amount, title, description, dueDate } = req.body; // ❌ category حذف شد

        if (amount !== undefined && amount <= 0) {
            return res.status(400).json({ message: 'مبلغ باید بیشتر از صفر باشد' });
        }

        const updateFields = {};
        if (amount !== undefined) updateFields.amount = amount;
        if (title !== undefined) updateFields.title = title;
        if (description !== undefined) updateFields.description = description;
        if (dueDate !== undefined) updateFields.dueDate = dueDate;

        const updatedTx = await Transaction.findOneAndUpdate(
            { _id: id, userId: req.user.id },
            updateFields,
            { new: true, runValidators: true }
        );

        if (!updatedTx) {
            return res.status(404).json({ message: 'تراکنش مورد نظر یافت نشد' });
        }

        res.status(200).json({ message: 'تراکنش با موفقیت ویرایش شد', transaction: updatedTx });
    } catch (error) {
        res.status(500).json({ message: 'خطای سرور', error: error.message });
    }
};

// ۶. حذف تراکنش
exports.deleteTransaction = async (req, res) => {
    try {
        const { id } = req.params;

        const transaction = await Transaction.findOne({ _id: id, userId: req.user.id });

        if (!transaction) {
            return res.status(404).json({ message: 'تراکنش مورد نظر یافت نشد' });
        }

        if (transaction.type === 'LOAN') {
            await Transaction.deleteMany({ loanId: transaction._id, userId: req.user.id });
        }

        await Transaction.deleteOne({ _id: id });

        res.status(200).json({ message: 'تراکنش با موفقیت حذف شد' });
    } catch (error) {
        res.status(500).json({ message: 'خطای سرور', error: error.message });
    }
};

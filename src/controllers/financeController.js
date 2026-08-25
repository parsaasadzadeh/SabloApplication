const Transaction = require('../models/Transaction');
const mongoose = require('mongoose');
const CATEGORIES = require('../constants/categories');

const VALID_CATEGORY_IDS = CATEGORIES.map(c => c.id);

const resolveCategoryId = (category) => {
    if (!category) return null;
    return VALID_CATEGORY_IDS.includes(category) ? category : null;
};

// ثبت تراکنش جدید
exports.addTransaction = async (req, res) => {
    try {
        const { type, amount, title, description, dueDate, loanId, category } = req.body;

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
            category: resolveCategoryId(category),
            loanId: loanId ? new mongoose.Types.ObjectId(loanId) : null,
            isPaid: ['LOAN', 'INCOME', 'EXPENSE'].includes(type) ? true : false
        });

        res.status(201).json({ message: 'تراکنش با موفقیت ثبت شد', transaction: newTx });
    } catch (error) {
        res.status(500).json({ message: 'خطای سرور', error: error.message });
    }
};

// لیست تراکنش‌ها
exports.getMyTransactions = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;
        const search = req.query.search?.trim();
        const fromDate = req.query.from;
        const toDate = req.query.to;

        const filter = { userId: req.user.id };

        if (fromDate || toDate) {
            filter.date = {};
            if (fromDate) filter.date.$gte = new Date(fromDate);
            if (toDate) {
                const to = new Date(toDate);
                to.setHours(23, 59, 59, 999);
                filter.date.$lte = to;
            }
        }

        if (search) {
            filter.$or = [
                { title: { $regex: search, $options: 'i' } },
                { description: { $regex: search, $options: 'i' } },
            ];
        }

        const [transactions, totalTransactions] = await Promise.all([
            Transaction.find(filter).sort({ date: -1 }).skip(skip).limit(limit),
            Transaction.countDocuments(filter),
        ]);

        // اضافه کردن اطلاعات دسته‌بندی به هر تراکنش
        const enriched = transactions.map(tx => {
            const txObj = tx.toObject();
            if (txObj.category) {
                const cat = CATEGORIES.find(c => c.id === txObj.category);
                txObj.categoryInfo = cat || null;
            } else {
                txObj.categoryInfo = null;
            }
            return txObj;
        });

        res.status(200).json({
            currentPage: page,
            totalPages: Math.ceil(totalTransactions / limit),
            totalItems: totalTransactions,
            transactions: enriched,
        });
    } catch (error) {
        res.status(500).json({ message: 'خطای سرور', error: error.message });
    }
};

// تحلیل‌گر هوش مصنوعی
exports.calculateUserStats = async (userId) => {
    const stats = await Transaction.aggregate([
        { $match: { userId: new mongoose.Types.ObjectId(userId) } },
        {
            $facet: {
                totals: [
                    {
                        $group: {
                            _id: '$type',
                            totalAmount: {
                                $sum: {
                                    $cond: [
                                        { $eq: ['$type', 'INSTALLMENT'] },
                                        { $cond: ['$isPaid', '$amount', 0] },
                                        '$amount'
                                    ]
                                }
                            }
                        }
                    }
                ],
                unpaidInstallments: [
                    { $match: { type: 'INSTALLMENT', isPaid: false } },
                    { $group: { _id: null, totalRemaining: { $sum: '$amount' }, count: { $sum: 1 } } }
                ]
            }
        }
    ]);

    const rawTotals = stats[0].totals;
    const unpaid = stats[0].unpaidInstallments[0] || { totalRemaining: 0, count: 0 };
    let income = 0, expense = 0, loans = 0, installmentsPaid = 0;

    rawTotals.forEach(item => {
        if (item._id === 'INCOME') income = item.totalAmount;
        if (item._id === 'EXPENSE') expense = item.totalAmount;
        if (item._id === 'LOAN') loans = item.totalAmount;
        if (item._id === 'INSTALLMENT') installmentsPaid = item.totalAmount;
    });

    return {
        cashBalance: (income + loans) - (expense + installmentsPaid),
        totalIncome: income,
        totalExpense: expense,
        activeDebt: loans - installmentsPaid,
        unpaidInstallmentsCount: unpaid.count,
        unpaidInstallmentsAmount: unpaid.totalRemaining
    };
};

// محاسبات حساب — نمودار دایره‌ای قدیمی (درآمد/خرج/قسط)
exports.getFinanceStats = async (req, res) => {
    try {
        const userId = new mongoose.Types.ObjectId(req.user.id);

        const stats = await Transaction.aggregate([
            { $match: { userId } },
            {
                $facet: {
                    totals: [
                        {
                            $group: {
                                _id: '$type',
                                totalAmount: {
                                    $sum: {
                                        $cond: [
                                            { $eq: ['$type', 'INSTALLMENT'] },
                                            { $cond: ['$isPaid', '$amount', 0] },
                                            '$amount'
                                        ]
                                    }
                                }
                            }
                        }
                    ],
                    unpaidInstallments: [
                        { $match: { type: 'INSTALLMENT', isPaid: false } },
                        { $group: { _id: null, totalRemaining: { $sum: '$amount' }, count: { $sum: 1 } } }
                    ]
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
            if (item._id === 'INSTALLMENT') installmentsPaid = item.totalAmount;
        });

        res.status(200).json({
            summary: {
                cashBalance: (income + loans) - (expense + installmentsPaid),
                totalIncome: income,
                totalExpense: expense,
                activeDebt: loans - installmentsPaid,
                unpaidInstallmentsCount: unpaidInstallmentsData.count,
                unpaidInstallmentsAmount: unpaidInstallmentsData.totalRemaining
            }
        });
    } catch (error) {
        res.status(500).json({ message: 'خطای سرور', error: error.message });
    }
};

// نمودار دایره‌ای جدید — بر اساس دسته‌بندی
exports.getCategoryStats = async (req, res) => {
    try {
        const userId = new mongoose.Types.ObjectId(req.user.id);
        const { type, from, to } = req.query;

        const match = {
            userId,
            category: { $ne: null, $exists: true }
        };

        if (type) match.type = type;

        if (from || to) {
            match.date = {};
            if (from) match.date.$gte = new Date(from);
            if (to) {
                const toDate = new Date(to);
                toDate.setHours(23, 59, 59, 999);
                match.date.$lte = toDate;
            }
        }

        const stats = await Transaction.aggregate([
            { $match: match },
            {
                $group: {
                    _id: '$category',
                    totalAmount: { $sum: '$amount' },
                    count: { $sum: 1 }
                }
            },
            { $sort: { totalAmount: -1 } }
        ]);

        const total = stats.reduce((sum, item) => sum + item.totalAmount, 0);

        const result = stats.map(item => {
            const cat = CATEGORIES.find(c => c.id === item._id);
            return {
                id: item._id,
                label: cat ? cat.label : item._id,
                icon: cat ? cat.icon : '📦',
                totalAmount: item.totalAmount,
                count: item.count,
                percentage: total > 0 ? Math.round((item.totalAmount / total) * 100) : 0
            };
        });

        res.status(200).json({ total, categories: result });
    } catch (error) {
        res.status(500).json({ message: 'خطای سرور', error: error.message });
    }
};

// لیست دسته‌بندی‌ها — فرانت ازش می‌خونه
exports.getCategories = async (req, res) => {
    try {
        res.status(200).json({ categories: CATEGORIES });
    } catch (error) {
        res.status(500).json({ message: 'خطای سرور', error: error.message });
    }
};

// پرداخت قسط
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

// ویرایش تراکنش
exports.updateTransaction = async (req, res) => {
    try {
        const { id } = req.params;
        const { amount, title, description, dueDate, category } = req.body;

        if (amount !== undefined && amount <= 0) {
            return res.status(400).json({ message: 'مبلغ باید بیشتر از صفر باشد' });
        }

        const updateFields = {};
        if (amount !== undefined) updateFields.amount = amount;
        if (title !== undefined) updateFields.title = title;
        if (description !== undefined) updateFields.description = description;
        if (dueDate !== undefined) updateFields.dueDate = dueDate;
        if (category !== undefined) updateFields.category = resolveCategoryId(category);

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

// حذف تراکنش
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

// مقایسه ماه جاری با ماه قبل
exports.getMonthlyComparison = async (req, res) => {
    try {
        const userId = new mongoose.Types.ObjectId(req.user.id);
        const now = new Date();

        const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const currentMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
        const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);

        const calcStats = async (start, end) => {
            const stats = await Transaction.aggregate([
                { $match: { userId, date: { $gte: start, $lte: end } } },
                {
                    $facet: {
                        totals: [
                            {
                                $group: {
                                    _id: '$type',
                                    totalAmount: {
                                        $sum: {
                                            $cond: [
                                                { $eq: ['$type', 'INSTALLMENT'] },
                                                { $cond: ['$isPaid', '$amount', 0] },
                                                '$amount'
                                            ]
                                        }
                                    }
                                }
                            }
                        ],
                        unpaidInstallments: [
                            { $match: { type: 'INSTALLMENT', isPaid: false } },
                            { $group: { _id: null, totalRemaining: { $sum: '$amount' } } }
                        ]
                    }
                }
            ]);

            const rawTotals = stats[0].totals;
            let income = 0, expense = 0, loans = 0, installmentsPaid = 0;
            rawTotals.forEach(item => {
                if (item._id === 'INCOME') income = item.totalAmount;
                if (item._id === 'EXPENSE') expense = item.totalAmount;
                if (item._id === 'LOAN') loans = item.totalAmount;
                if (item._id === 'INSTALLMENT') installmentsPaid = item.totalAmount;
            });

            return {
                income,
                expense,
                cashBalance: (income + loans) - (expense + installmentsPaid),
            };
        };

        const [current, previous] = await Promise.all([
            calcStats(currentMonthStart, currentMonthEnd),
            calcStats(prevMonthStart, prevMonthEnd),
        ]);

        const calcChange = (curr, prev) => {
            if (prev === 0) return curr > 0 ? 100 : 0;
            return Math.round(((curr - prev) / prev) * 100);
        };

        res.status(200).json({
            current,
            previous,
            changes: {
                income: calcChange(current.income, previous.income),
                expense: calcChange(current.expense, previous.expense),
                cashBalance: calcChange(current.cashBalance, previous.cashBalance),
            }
        });
    } catch (error) {
        res.status(500).json({ message: 'خطای سرور', error: error.message });
    }
};

// خروجی CSV
exports.exportTransactionsCSV = async (req, res) => {
    try {
        const search = req.query.search?.trim();
        const fromDate = req.query.from;
        const toDate = req.query.to;

        const filter = { userId: req.user.id };

        if (fromDate || toDate) {
            filter.date = {};
            if (fromDate) filter.date.$gte = new Date(fromDate);
            if (toDate) {
                const to = new Date(toDate);
                to.setHours(23, 59, 59, 999);
                filter.date.$lte = to;
            }
        }

        if (search) {
            filter.$or = [
                { title: { $regex: search, $options: 'i' } },
                { description: { $regex: search, $options: 'i' } },
            ];
        }

        const transactions = await Transaction.find(filter).sort({ date: -1 });

        const typeLabel = (type) => {
            const map = { INCOME: 'درآمد', EXPENSE: 'خرج', INSTALLMENT: 'قسط', LOAN: 'وام' };
            return map[type] || type;
        };

        const categoryLabel = (catId) => {
            if (!catId) return '-';
            const cat = CATEGORIES.find(c => c.id === catId);
            return cat ? `${cat.icon} ${cat.label}` : catId;
        };

        const escape = (val) => `"${String(val ?? '').replace(/"/g, '""')}"`;

        const rows = [
            ['ردیف', 'عنوان', 'نوع', 'دسته‌بندی', 'مبلغ (ریال)', 'توضیحات', 'تاریخ', 'وضعیت پرداخت'].join(','),
            ...transactions.map((tx, i) => {
                const date = new Date(tx.date).toLocaleDateString('fa-IR');
                const isPaid = tx.type === 'INSTALLMENT'
                    ? (tx.isPaid ? 'پرداخت شده' : 'پرداخت نشده')
                    : '-';
                return [
                    i + 1,
                    escape(tx.title),
                    escape(typeLabel(tx.type)),
                    escape(categoryLabel(tx.category)),
                    tx.amount,
                    escape(tx.description || ''),
                    escape(date),
                    escape(isPaid),
                ].join(',');
            }),
        ].join('\n');

        const csv = '\uFEFF' + rows;

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="sablo-transactions-${Date.now()}.csv"`);
        res.status(200).send(csv);
    } catch (error) {
        res.status(500).json({ message: 'خطای سرور', error: error.message });
    }
};

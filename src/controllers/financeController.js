const Transaction = require('../models/Transaction');
const Category = require('../models/Category');
const Card = require('../models/Card');
const mongoose = require('mongoose');
const CATEGORIES = require('../constants/categories');
const { calculateDong } = require('../utils/dongCalculator');
const MAX_CUSTOM_CATEGORIES_PER_USER = 30;

// ---------------------------------------------------------------------
// helper تاریخ
// ---------------------------------------------------------------------
const buildDateMatch = (from, to) => {
    const dateMatch = {};
    if (from || to) {
        dateMatch.date = {};
        if (from) dateMatch.date.$gte = new Date(from);
        if (to) {
            const toDate = new Date(to);
            toDate.setHours(23, 59, 59, 999);
            dateMatch.date.$lte = toDate;
        }
    }
    return dateMatch;
};

// ---------------------------------------------------------------------
// helper خلاصه مالی — cardId اختیاریه
// ---------------------------------------------------------------------
const computeFinanceSummary = async (userId, from, to, cardId = null) => {
    const matchBase = {
        userId: new mongoose.Types.ObjectId(userId),
        ...buildDateMatch(from, to)
    };

    if (cardId) {
        matchBase.cardId = new mongoose.Types.ObjectId(cardId);
    }

    const stats = await Transaction.aggregate([
        { $match: matchBase },
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
    let income = 0, expense = 0, loans = 0, installmentsPaid = 0, goalDeposits = 0;
    let transferIn = 0, transferOut = 0;

    rawTotals.forEach(item => {
        if (item._id === 'INCOME') income = item.totalAmount;
        if (item._id === 'EXPENSE') expense = item.totalAmount;
        if (item._id === 'LOAN') loans = item.totalAmount;
        if (item._id === 'INSTALLMENT') installmentsPaid = item.totalAmount;
        if (item._id === 'GOAL_DEPOSIT') goalDeposits = item.totalAmount;
        if (item._id === 'TRANSFER_IN') transferIn = item.totalAmount;
        if (item._id === 'TRANSFER_OUT') transferOut = item.totalAmount;
    });

    return {
        totalIncome: income,
        totalExpense: expense,
        totalGoalDeposits: goalDeposits,
        totalTransferIn: transferIn,
        totalTransferOut: transferOut,
        activeDebt: unpaid.totalRemaining,
        cashBalance:
            (income + loans + transferIn) -
            (expense + installmentsPaid + goalDeposits + transferOut),
        unpaidInstallmentsCount: unpaid.count,
        unpaidInstallmentsAmount: unpaid.totalRemaining
    };
};



// ---------------------------------------------------------------------
// helper اعتبارسنجی کارت — null برگردوندن = کارت نداره (مجاز)
// throw = کارت نامعتبره
// ---------------------------------------------------------------------

const resolveCardId = async (cardId, userId) => {
    if (!cardId) return null;
    const card = await Card.findOne({ _id: cardId, userId });
    if (!card) throw new Error('INVALID_CARD');
    return card._id;
};

// ---------------------------------------------------------------------
// helperهای دسته‌بندی
// ---------------------------------------------------------------------

const getUserCategoryMap = async (userId) => {
    const customCats = await Category.find({ userId }).lean();
    const map = new Map();
    CATEGORIES.forEach(c => map.set(c.id, { label: c.label, icon: c.icon, isCustom: false }));
    customCats.forEach(c => map.set(c.id, { label: c.label, icon: c.icon, isCustom: true }));
    return map;
};

const resolveCategoryId = (category, categoryMap) => {
    if (!category) return null;
    return categoryMap.has(category) ? category : null;
};

const FALLBACK_CATEGORY_INFO = { label: 'دسته‌بندی حذف‌شده', icon: '❓' };
const lookupCategoryInfo = (categoryId, categoryMap) => {
    if (!categoryId) return null;
    return categoryMap.get(categoryId) || FALLBACK_CATEGORY_INFO;
};

// ---------------------------------------------------------------------
// ثبت تراکنش جدید
// ---------------------------------------------------------------------

exports.addTransaction = async (req, res) => {
    try {
        const { type, amount, title, description, dueDate, loanId, category, date, cardId } = req.body;

        if (amount <= 0) {
            return res.status(400).json({ message: 'مبلغ باید بیشتر از صفر باشد' });
        }
        if (type === 'GOAL_DEPOSIT') {
            return res.status(400).json({ message: 'این نوع تراکنش فقط از طریق واریز به هدف قابل ثبت است' });
        }


        let txDate = new Date();
        if (date) {
            const parsedDate = new Date(date);
            if (isNaN(parsedDate.getTime())) {
                return res.status(400).json({ message: 'تاریخ تراکنش نامعتبر است' });
            }
            const oneDayMs = 24 * 60 * 60 * 1000;
            if (parsedDate.getTime() > Date.now() + oneDayMs) {
                return res.status(400).json({ message: 'تاریخ تراکنش نمی‌تواند در آینده باشد' });
            }
            txDate = parsedDate;
        }

        const categoryMap = await getUserCategoryMap(req.user.id);
        const resolvedCategory = resolveCategoryId(category, categoryMap);

        let resolvedCardId = null;
        try {
            resolvedCardId = await resolveCardId(cardId, req.user.id);
        } catch {
            return res.status(400).json({ message: 'کارت انتخاب‌شده معتبر نیست' });
        }

        const newTx = await Transaction.create({
            userId: req.user.id,
            type,
            amount,
            title,
            description,
            dueDate,
            date: txDate,
            category: resolvedCategory,
            cardId: resolvedCardId,
            loanId: loanId ? new mongoose.Types.ObjectId(loanId) : null,
            isPaid: ['LOAN', 'INCOME', 'EXPENSE'].includes(type) ? true : false
        });

        res.status(201).json({ message: 'تراکنش با موفقیت ثبت شد', transaction: newTx });
    } catch (error) {
        res.status(500).json({ message: 'خطای سرور', error: error.message });
    }
};

// ---------------------------------------------------------------------
// لیست تراکنش‌ها — فیلتر کارت اضافه شد
// ---------------------------------------------------------------------

exports.getMyTransactions = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;
        const search = req.query.search?.trim();
        const fromDate = req.query.from;
        const toDate = req.query.to;

        const filter = { userId: req.user.id, ...buildDateMatch(fromDate, toDate) };

        if (req.query.cardId === 'none') {
            filter.cardId = null;
        } else if (req.query.cardId) {
            filter.cardId = new mongoose.Types.ObjectId(req.query.cardId);
        }

        if (search) {
            filter.$or = [
                { title: { $regex: search, $options: 'i' } },
                { description: { $regex: search, $options: 'i' } },
            ];
        }
        if (req.query.type) {
  filter.type = req.query.type;
}

        const [transactions, totalTransactions, categoryMap] = await Promise.all([
            Transaction.find(filter).sort({ date: -1 }).skip(skip).limit(limit),
            Transaction.countDocuments(filter),
            getUserCategoryMap(req.user.id),
        ]);

        const enriched = transactions.map(tx => {
            const txObj = tx.toObject();
            const info = lookupCategoryInfo(txObj.category, categoryMap);
            txObj.categoryInfo = info ? { id: txObj.category, ...info } : null;
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

// ---------------------------------------------------------------------
// تحلیل‌گر هوش مصنوعی
// ---------------------------------------------------------------------

exports.calculateUserStats = async (userId) => {
    return computeFinanceSummary(userId);
};

// ---------------------------------------------------------------------
// خلاصه مالی — cardId اختیاری
// ---------------------------------------------------------------------

exports.getFinanceStats = async (req, res) => {
    try {
        const { from, to, cardId } = req.query;

        if (cardId) {
            const card = await Card.findOne({ _id: cardId, userId: req.user.id });
            if (!card) {
                return res.status(400).json({ message: 'کارت انتخاب‌شده معتبر نیست' });
            }
        }

        const summary = await computeFinanceSummary(req.user.id, from, to, cardId || null);
        res.status(200).json({ summary });
    } catch (error) {
        res.status(500).json({ message: 'خطای سرور', error: error.message });
    }
};

// ---------------------------------------------------------------------
// نمودار دایره‌ای دسته‌بندی — cardId اختیاری
// ---------------------------------------------------------------------

exports.getCategoryStats = async (req, res) => {
    try {
        const userId = new mongoose.Types.ObjectId(req.user.id);
        const { type, from, to, cardId } = req.query;
        const dateMatch = buildDateMatch(from, to);

        const baseMatch = { userId, ...dateMatch };

        if (cardId) {
            const card = await Card.findOne({ _id: cardId, userId: req.user.id });
            if (!card) return res.status(400).json({ message: 'کارت انتخاب‌شده معتبر نیست' });
            baseMatch.cardId = card._id;
        }

        if (type === 'INCOME') {
            const incomeAgg = await Transaction.aggregate([
                { $match: { ...baseMatch, type: 'INCOME' } },
                { $group: { _id: null, totalAmount: { $sum: '$amount' }, count: { $sum: 1 } } }
            ]);
            const income = incomeAgg[0] || { totalAmount: 0, count: 0 };
            const categories = income.totalAmount > 0 ? [{
                id: 'INCOME',
                label: 'درآمد',
                icon: '💰',
                totalAmount: income.totalAmount,
                count: income.count,
                percentage: 100
            }] : [];
            return res.status(200).json({ total: income.totalAmount, categories });
        }

        const match = { ...baseMatch, category: { $ne: null, $exists: true } };
        if (type) match.type = type;

        const [stats, categoryMap] = await Promise.all([
            Transaction.aggregate([
                { $match: match },
                {
                    $group: {
                        _id: '$category',
                        totalAmount: { $sum: '$amount' },
                        count: { $sum: 1 }
                    }
                },
                { $sort: { totalAmount: -1 } }
            ]),
            getUserCategoryMap(req.user.id),
        ]);

        const total = stats.reduce((sum, item) => sum + item.totalAmount, 0);

        const result = stats.map(item => {
            const info = lookupCategoryInfo(item._id, categoryMap) || FALLBACK_CATEGORY_INFO;
            return {
                id: item._id,
                label: info.label,
                icon: info.icon,
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

// ---------------------------------------------------------------------
// دسته‌بندی‌ها
// ---------------------------------------------------------------------

exports.getCategories = async (req, res) => {
    try {
        const customCats = await Category.find({ userId: req.user.id }).lean();
        const presets = CATEGORIES.map(c => ({ ...c, isCustom: false }));
        const custom = customCats.map(c => ({ id: c.id, label: c.label, icon: c.icon, isCustom: true }));
        res.status(200).json({ categories: [...presets, ...custom] });
    } catch (error) {
        res.status(500).json({ message: 'خطای سرور', error: error.message });
    }
};

exports.addCustomCategory = async (req, res) => {
    try {
        const { label, icon } = req.body;
        const trimmedLabel = String(label ?? '').trim();

        if (!trimmedLabel) {
            return res.status(400).json({ message: 'نام دسته‌بندی الزامی است' });
        }
        if (trimmedLabel.length > 30) {
            return res.status(400).json({ message: 'نام دسته‌بندی خیلی طولانی است' });
        }

        const existingCount = await Category.countDocuments({ userId: req.user.id });
        if (existingCount >= MAX_CUSTOM_CATEGORIES_PER_USER) {
            return res.status(400).json({ message: `حداکثر ${MAX_CUSTOM_CATEGORIES_PER_USER} دسته‌بندی شخصی مجاز است` });
        }

        const duplicate = await Category.findOne({
            userId: req.user.id,
            label: { $regex: `^${trimmedLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' }
        });
        if (duplicate) {
            return res.status(400).json({ message: 'این دسته‌بندی از قبل وجود دارد' });
        }

        const newCategory = await Category.create({
            userId: req.user.id,
            id: new mongoose.Types.ObjectId().toHexString(),
            label: trimmedLabel,
            icon: icon && String(icon).trim() ? String(icon).trim() : '',
        });

        res.status(201).json({
            message: 'دسته‌بندی با موفقیت ساخته شد',
            category: { id: newCategory.id, label: newCategory.label, icon: newCategory.icon, isCustom: true }
        });
    } catch (error) {
        res.status(500).json({ message: 'خطای سرور', error: error.message });
    }
};

exports.deleteCustomCategory = async (req, res) => {
    try {
        const { id } = req.params;
        const deleted = await Category.findOneAndDelete({ id, userId: req.user.id });

        if (!deleted) {
            return res.status(404).json({ message: 'دسته‌بندی مورد نظر یافت نشد' });
        }

        res.status(200).json({ message: 'دسته‌بندی با موفقیت حذف شد' });
    } catch (error) {
        res.status(500).json({ message: 'خطای سرور', error: error.message });
    }
};

// ---------------------------------------------------------------------
// پرداخت قسط
// ---------------------------------------------------------------------
exports.payInstallment = async (req, res) => {
    try {
        const installmentId = req.params.id;
        const { cardId } = req.body;

        const updateFields = { isPaid: true, date: Date.now() };

        if (cardId !== undefined) {
            if (cardId === null) {
                updateFields.cardId = null;
            } else {
                try {
                    updateFields.cardId = await resolveCardId(cardId, req.user.id);
                } catch {
                    return res.status(400).json({ message: 'کارت انتخاب‌شده معتبر نیست' });
                }
            }
        }

        // ✅ شرط isPaid:false مستقیم تو همین کوئری — این atomic بودنشه
        const updatedInstallment = await Transaction.findOneAndUpdate(
            { _id: installmentId, userId: req.user.id, type: 'INSTALLMENT', isPaid: false },
            updateFields,
            { new: true }
        );

        // اگه چیزی برنگشت، یا اصلاً وجود نداره یا قبلاً پرداخت شده — این یکی رو جدا چک می‌کنیم فقط برای پیام درست
        if (!updatedInstallment) {
            const exists = await Transaction.findOne({ _id: installmentId, userId: req.user.id, type: 'INSTALLMENT' });
            if (!exists) {
                return res.status(404).json({ message: 'قسط مورد نظر یافت نشد' });
            }
            return res.status(400).json({ message: 'این قسط قبلاً پرداخت شده است' });
        }

        res.status(200).json({ message: 'قسط با موفقیت پرداخت شد', installment: updatedInstallment });
    } catch (error) {
        res.status(500).json({ message: 'خطای سرور', error: error.message });
    }
};
// ---------------------------------------------------------------------
// ویرایش تراکنش — cardId اضافه شد
// ---------------------------------------------------------------------

exports.updateTransaction = async (req, res) => {
    try {
        const { id } = req.params;
        const { amount, title, description, dueDate, category, date, cardId } = req.body;

        if (amount !== undefined && amount <= 0) {
            return res.status(400).json({ message: 'مبلغ باید بیشتر از صفر باشد' });
        }

        // تراکنش انتقالی: مبلغ و کارت قابل تغییر نیست (برای جلوگیری از ناهماهنگی دو سمت)
        const existing = await Transaction.findOne({ _id: id, userId: req.user.id })
            .select('transferId')
            .lean();

        if (!existing) {
            return res.status(404).json({ message: 'تراکنش مورد نظر یافت نشد' });
        }

        if (existing.transferId && (amount !== undefined || cardId !== undefined)) {
            return res.status(400).json({
                message: 'مبلغ و کارت انتقال قابل ویرایش نیست؛ انتقال را حذف و دوباره ثبت کن'
            });
        }

        const updateFields = {};
        if (amount !== undefined) updateFields.amount = amount;
        if (title !== undefined) updateFields.title = title;
        if (description !== undefined) updateFields.description = description;
        if (dueDate !== undefined) updateFields.dueDate = dueDate;

        if (category !== undefined) {
            const categoryMap = await getUserCategoryMap(req.user.id);
            updateFields.category = resolveCategoryId(category, categoryMap);
        }

        if (date !== undefined) {
            const parsedDate = new Date(date);
            if (isNaN(parsedDate.getTime())) {
                return res.status(400).json({ message: 'تاریخ تراکنش نامعتبر است' });
            }
            const oneDayMs = 24 * 60 * 60 * 1000;
            if (parsedDate.getTime() > Date.now() + oneDayMs) {
                return res.status(400).json({ message: 'تاریخ تراکنش نمی‌تواند در آینده باشد' });
            }
            updateFields.date = parsedDate;
        }

        if (cardId !== undefined) {
            if (cardId === null) {
                updateFields.cardId = null;
            } else {
                try {
                    updateFields.cardId = await resolveCardId(cardId, req.user.id);
                } catch {
                    return res.status(400).json({ message: 'کارت انتخاب‌شده معتبر نیست' });
                }
            }
        }

        const updatedTx = await Transaction.findOneAndUpdate(
            { _id: id, userId: req.user.id },
            updateFields,
            { new: true, runValidators: true }
        );

        res.status(200).json({ message: 'تراکنش با موفقیت ویرایش شد', transaction: updatedTx });
    } catch (error) {
        res.status(500).json({ message: 'خطای سرور', error: error.message });
    }
};

// ---------------------------------------------------------------------
// حذف تراکنش
// ---------------------------------------------------------------------

exports.deleteTransaction = async (req, res) => {
    try {
        const { id } = req.params;

        const transaction = await Transaction.findOne({ _id: id, userId: req.user.id });

        if (!transaction) {
            return res.status(404).json({ message: 'تراکنش مورد نظر یافت نشد' });
        }

        // حذف هر دو سمت انتقال
        if (transaction.transferId) {
            await Transaction.deleteMany({ transferId: transaction.transferId, userId: req.user.id });
        } else if (transaction.type === 'LOAN') {
            await Transaction.deleteMany({ loanId: transaction._id, userId: req.user.id });
        }

        await Transaction.deleteOne({ _id: id });

        res.status(200).json({ message: 'تراکنش با موفقیت حذف شد' });
    } catch (error) {
        res.status(500).json({ message: 'خطای سرور', error: error.message });
    }
};

// ---------------------------------------------------------------------
// مقایسه ماه جاری با ماه قبل
// ---------------------------------------------------------------------

exports.getMonthlyComparison = async (req, res) => {
    try {
        const userId = req.user.id;
        const now = new Date();

        const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const currentMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
        const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);

        const [current, previous] = await Promise.all([
            computeFinanceSummary(userId, currentMonthStart.toISOString(), currentMonthEnd.toISOString()),
            computeFinanceSummary(userId, prevMonthStart.toISOString(), prevMonthEnd.toISOString()),
        ]);

        const calcChange = (curr, prev) => {
            if (prev === 0) return curr > 0 ? 100 : 0;
            return Math.round(((curr - prev) / prev) * 100);
        };

        res.status(200).json({
            current: {
                income: current.totalIncome,
                expense: current.totalExpense,
                cashBalance: current.cashBalance,
            },
            previous: {
                income: previous.totalIncome,
                expense: previous.totalExpense,
                cashBalance: previous.cashBalance,
            },
            changes: {
                income: calcChange(current.totalIncome, previous.totalIncome),
                expense: calcChange(current.totalExpense, previous.totalExpense),
                cashBalance: calcChange(current.cashBalance, previous.cashBalance),
            }
        });
    } catch (error) {
        res.status(500).json({ message: 'خطای سرور', error: error.message });
    }
};

// ---------------------------------------------------------------------
// خروجی CSV — ستون کارت اضافه شد
// ---------------------------------------------------------------------

exports.exportTransactionsCSV = async (req, res) => {
    try {
        const search = req.query.search?.trim();
        const fromDate = req.query.from;
        const toDate = req.query.to;

        const filter = { userId: req.user.id, ...buildDateMatch(fromDate, toDate) };

        if (req.query.cardId === 'none') {
            filter.cardId = null;
        } else if (req.query.cardId) {
            filter.cardId = new mongoose.Types.ObjectId(req.query.cardId);
        }

        if (search) {
            filter.$or = [
                { title: { $regex: search, $options: 'i' } },
                { description: { $regex: search, $options: 'i' } },
            ];
        }

        const [transactions, categoryMap, cards] = await Promise.all([
            Transaction.find(filter).sort({ date: -1 }),
            getUserCategoryMap(req.user.id),
            Card.find({ userId: req.user.id }).lean(),
        ]);

        const cardMap = new Map();
        cards.forEach(c => cardMap.set(c._id.toString(), c.name));

      const typeLabel = (type) => {
    const map = {
        INCOME: 'درآمد',
        EXPENSE: 'خرج',
        INSTALLMENT: 'قسط',
        LOAN: 'وام',
        GOAL_DEPOSIT: 'واریز به هدف',
        TRANSFER_IN: 'انتقال ورودی',
        TRANSFER_OUT: 'انتقال خروجی',
    };
    return map[type] || type;
};
        const categoryLabel = (catId) => {
            const info = lookupCategoryInfo(catId, categoryMap);
            return info ? `${info.icon} ${info.label}` : '-';
        };

        const escape = (val) => `"${String(val ?? '').replace(/"/g, '""')}"`;

        const rows = [
            ['ردیف', 'عنوان', 'نوع', 'دسته‌بندی', 'کارت', 'مبلغ (ریال)', 'توضیحات', 'تاریخ', 'وضعیت پرداخت'].join(','),
            ...transactions.map((tx, i) => {
                const date = new Date(tx.date).toLocaleDateString('fa-IR');
                const isPaid = tx.type === 'INSTALLMENT'
                    ? (tx.isPaid ? 'پرداخت شده' : 'پرداخت نشده')
                    : '-';
                const cardName = tx.cardId ? (cardMap.get(tx.cardId.toString()) || '-') : '-';
                return [
                    i + 1,
                    escape(tx.title),
                    escape(typeLabel(tx.type)),
                    escape(categoryLabel(tx.category)),
                    escape(cardName),
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

// ---------------------------------------------------------------------
// نمای کلی چند ماه اخیر
// ---------------------------------------------------------------------

exports.getMonthlyOverview = async (req, res) => {
    try {
        const userId = new mongoose.Types.ObjectId(req.user.id);
        const monthsCount = Math.min(Math.max(parseInt(req.query.months) || 6, 1), 24);

        const now = new Date();
        const startRange = new Date(now.getFullYear(), now.getMonth() - (monthsCount - 1), 1);

        const matchBase = { userId, date: { $gte: startRange } };

        if (req.query.cardId) {
            const card = await Card.findOne({ _id: req.query.cardId, userId: req.user.id });
            if (!card) {
                return res.status(400).json({ message: 'کارت انتخاب‌شده معتبر نیست' });
            }
            matchBase.cardId = card._id;
        }

        const stats = await Transaction.aggregate([
            { $match: matchBase },
            {
                $group: {
                    _id: {
                        year: { $year: '$date' },
                        month: { $month: '$date' },
                        type: '$type',
                    },
                    totalAmount: {
                        $sum: {
                            $cond: [
                                { $eq: ['$type', 'INSTALLMENT'] },
                                { $cond: ['$isPaid', '$amount', 0] },
                                '$amount',
                            ],
                        },
                    },
                },
            },
        ]);

        // ── جمع مبالغ هر ماه به تفکیک نوع تراکنش ─────────────────────────
        const emptyMonth = () => ({
            INCOME: 0,
            EXPENSE: 0,
            LOAN: 0,
            INSTALLMENT: 0,
            GOAL_DEPOSIT: 0,
            TRANSFER_IN: 0,
            TRANSFER_OUT: 0,
        });

        const monthsMap = {};
        stats.forEach(item => {
            const { year, month, type } = item._id;
            const key = `${year}-${month}`;
            if (!monthsMap[key]) monthsMap[key] = emptyMonth();
            if (type in monthsMap[key]) {
                monthsMap[key][type] = item.totalAmount;
            }
        });

        // ── ساخت خروجی ماه‌به‌ماه ────────────────────────────────────────
        const result = [];
        for (let i = 0; i < monthsCount; i++) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const key = `${d.getFullYear()}-${d.getMonth() + 1}`;
            const data = monthsMap[key] || emptyMonth();

            const moneyIn = data.INCOME + data.LOAN + data.TRANSFER_IN;
            const moneyOut =
                data.EXPENSE + data.INSTALLMENT + data.GOAL_DEPOSIT + data.TRANSFER_OUT;

            result.push({
                year: d.getFullYear(),
                month: d.getMonth() + 1,
                from: new Date(d.getFullYear(), d.getMonth(), 1),
                to: new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59),
                income: data.INCOME,
                expense: data.EXPENSE,
                transferIn: data.TRANSFER_IN,
                transferOut: data.TRANSFER_OUT,
                balance: moneyIn - moneyOut,
            });
        }

        result.reverse();

        res.status(200).json({ months: result });
    } catch (error) {
        res.status(500).json({ message: 'خطای سرور', error: error.message });
    }
};

// ---------------------------------------------------------------------
// ساخت وام + اقساط
// تاریخ سررسید همه اقساط از فرانت میاد (installmentDates) و اینجا فقط
// اعتبارسنجی و ذخیره میشه؛ هیچ محاسبه‌ی تاریخی (مثل setMonth) در بک‌اند نیست.
// ---------------------------------------------------------------------

exports.createLoanWithInstallments = async (req, res) => {
    try {
        const {
            title,
            totalAmount,
            installmentCount,
            installmentAmount,
            installmentDates,
            description,
            cardId,
        } = req.body;

        const count = Number(installmentCount);

        if (!title || !String(title).trim()) {
            return res.status(400).json({ message: 'نام وام الزامی است' });
        }
        if (!totalAmount || totalAmount <= 0) {
            return res.status(400).json({ message: 'مبلغ کل وام باید بیشتر از صفر باشد' });
        }
        if (!Number.isInteger(count) || count < 1 || count > 360) {
            return res.status(400).json({ message: 'تعداد اقساط باید بین ۱ تا ۳۶۰ باشد' });
        }
        if (!installmentAmount || installmentAmount <= 0) {
            return res.status(400).json({ message: 'مبلغ هر قسط باید بیشتر از صفر باشد' });
        }

        // ── تاریخ اقساط ──────────────────────────────────────────────────
        if (!Array.isArray(installmentDates) || installmentDates.length !== count) {
            return res.status(400).json({ message: 'تاریخ اقساط الزامی است و باید با تعداد اقساط برابر باشد' });
        }

        const dueDates = installmentDates.map(d => (typeof d === 'string' ? new Date(d) : new Date(NaN)));
        if (dueDates.some(d => isNaN(d.getTime()))) {
            return res.status(400).json({ message: 'تاریخ اقساط نامعتبر است' });
        }
        for (let i = 1; i < dueDates.length; i++) {
            if (dueDates[i].getTime() <= dueDates[i - 1].getTime()) {
                return res.status(400).json({ message: 'تاریخ اقساط باید به ترتیب صعودی باشد' });
            }
        }

        let resolvedCardId = null;
        try {
            resolvedCardId = await resolveCardId(cardId, req.user.id);
        } catch {
            return res.status(400).json({ message: 'کارت انتخاب‌شده معتبر نیست' });
        }

        const firstDueDate = dueDates[0];
        const lastDueDate  = dueDates[dueDates.length - 1];
        const cleanTitle   = String(title).trim();

        // ── تراکنش اصلی وام ──────────────────────────────────────────────
        const loanTx = await Transaction.create({
            userId:      req.user.id,
            type:        'LOAN',
            amount:      totalAmount,
            title:       cleanTitle,
            description: description?.trim() || '',
            date:        new Date(),
            dueDate:     lastDueDate,
            isPaid:      true,
            loanId:      null,
            category:    null,
            cardId:      resolvedCardId,
        });

        // ── اقساط ────────────────────────────────────────────────────────
        const installments = dueDates.map((dueDate, i) => ({
            userId:      req.user.id,
            type:        'INSTALLMENT',
            amount:      installmentAmount,
            title:       `${cleanTitle} — قسط ${i + 1} از ${count}`,
            description: '',
            date:        new Date(),
            dueDate,
            isPaid:      false,
            loanId:      loanTx._id,
            category:    null,
            cardId:      resolvedCardId,
        }));

        try {
            await Transaction.insertMany(installments);
        } catch (insertError) {
            // اگه ساخت اقساط شکست خورد، وام نیمه‌کاره باقی نمونه
            await Transaction.deleteOne({ _id: loanTx._id });
            throw insertError;
        }

        res.status(201).json({
            message: `وام با ${count} قسط با موفقیت ثبت شد`,
            loan: {
                _id:              loanTx._id,
                title:            loanTx.title,
                totalAmount,
                installmentCount: count,
                installmentAmount,
                firstDueDate,
                lastDueDate,
                cardId:           resolvedCardId,
            },
        });
    } catch (error) {
        res.status(500).json({ message: 'خطای سرور', error: error.message });
    }
};

// ---------------------------------------------------------------------
// لیست وام‌ها
// ---------------------------------------------------------------------

exports.getLoans = async (req, res) => {
    try {
        const userId = req.user.id;

        const loans = await Transaction.find({ userId, type: 'LOAN' })
            .sort({ date: -1 }).lean();

        if (loans.length === 0) {
            return res.status(200).json({ loans: [] });
        }

        const loanIds = loans.map(l => l._id);

        const allInstallments = await Transaction.find({
            userId,
            type:   'INSTALLMENT',
            loanId: { $in: loanIds },
        }).sort({ dueDate: 1 }).lean();

        const installmentsByLoan = {};
        allInstallments.forEach(inst => {
            const key = inst.loanId.toString();
            if (!installmentsByLoan[key]) installmentsByLoan[key] = [];
            installmentsByLoan[key].push(inst);
        });

        const cards = await Card.find({ userId }).lean();
        const cardMap = new Map();
        cards.forEach(c => cardMap.set(c._id.toString(), { name: c.name, icon: c.icon, color: c.color }));

        const result = loans.map(loan => {
            const insts    = installmentsByLoan[loan._id.toString()] || [];
            const total    = insts.length;
            const paid     = insts.filter(i => i.isPaid).length;
            const unpaid   = insts.filter(i => !i.isPaid);
            const nextInst = unpaid[0] || null;

    const paidAmount  = insts.filter(i => i.isPaid).reduce((sum, i) => sum + i.amount, 0);
    const totalAmount = insts.reduce((sum, i) => sum + i.amount, 0);

            const cardInfo = loan.cardId ? (cardMap.get(loan.cardId.toString()) || null) : null;

            return {
                _id:              loan._id,
                title:            loan.title,
                description:      loan.description,
                date:             loan.date,
                cardId:           loan.cardId,
                cardInfo,
                totalLoanAmount:  loan.amount,
                totalAmount,
                paidAmount,
                remainingAmount:  totalAmount - paidAmount,
                installmentCount: total,
                paidCount:        paid,
                unpaidCount:      unpaid.length,
                progressPercent:  total > 0 ? Math.round((paid / total) * 100) : 0,
                isFullyPaid:      total > 0 && paid === total,
                nextInstallment:  nextInst ? {
                    _id:     nextInst._id,
                    amount:  nextInst.amount,
                    dueDate: nextInst.dueDate,
                    title:   nextInst.title,
                } : null,
                installments: insts.map(inst => ({
                    _id:     inst._id,
                    title:   inst.title,
                    amount:  inst.amount,
                    dueDate: inst.dueDate,
                    isPaid:  inst.isPaid,
                    date:    inst.date,
                })),
            };
        });

        res.status(200).json({ loans: result });
    } catch (error) {
        res.status(500).json({ message: 'خطای سرور', error: error.message });
    }
};
exports.getUnpaidInstallments = async (req, res) => {
    try {
        const since = new Date();
        since.setDate(since.getDate() - 1);

        const installments = await Transaction.find({
            userId: req.user.id,
            type: 'INSTALLMENT',
            isPaid: false,
            dueDate: { $gte: since },
        })
            .select('title amount dueDate loanId')
            .sort({ dueDate: 1 })
            .limit(200)
            .lean();

        res.status(200).json({ installments });
    } catch (error) {
        res.status(500).json({ message: 'خطای سرور', error: error.message });
    }
};


exports.calculateDong = async (req, res) => {
    try {
        const { participants } = req.body;

        if (!Array.isArray(participants) || participants.length < 2 || participants.length > 30) {
            return res.status(400).json({ message: 'تعداد افراد باید بین ۲ تا ۳۰ باشد' });
        }

        for (const p of participants) {
            if (!String(p.name ?? '').trim()) {
                return res.status(400).json({ message: 'نام همه افراد الزامی است' });
            }
            if (!Number.isInteger(p.paid) || p.paid < 0) {
                return res.status(400).json({ message: 'مبلغ پرداختی باید عدد صحیح و غیرمنفی باشد' });
            }
            if (p.weight !== undefined && (!Number.isInteger(p.weight) || p.weight < 1)) {
                return res.status(400).json({ message: 'وزن سهم نامعتبر است' });
            }
        }

        const result = calculateDong(participants);
        if (result.total === 0) {
            return res.status(400).json({ message: 'جمع هزینه‌ها صفر است' });
        }

        res.status(200).json({ ...result, settlementsCount: result.settlements.length });
    } catch (error) {
        res.status(500).json({ message: 'خطای سرور', error: error.message });
    }
};

// ثبت سهم خودم از دنگ به‌عنوان خرج در حسابداری
exports.saveDongAsExpense = async (req, res) => {
    try {
        const { title, myShare, category, cardId } = req.body;

        if (!Number.isInteger(myShare) || myShare <= 0) {
            return res.status(400).json({ message: 'مبلغ سهم نامعتبر است' });
        }

        const categoryMap = await getUserCategoryMap(req.user.id);
        let resolvedCardId = null;
        try {
            resolvedCardId = await resolveCardId(cardId, req.user.id);
        } catch {
            return res.status(400).json({ message: 'کارت انتخاب‌شده معتبر نیست' });
        }

        const tx = await Transaction.create({
            userId: req.user.id,
            type: 'EXPENSE',
            amount: myShare,
            title: title?.trim() || 'دنگ',
            description: 'ثبت‌شده از ماشین‌حساب دنگی',
            date: new Date(),
            category: resolveCategoryId(category, categoryMap),
            cardId: resolvedCardId,
            isPaid: true,
        });

        res.status(201).json({ message: 'سهم شما به‌عنوان خرج ثبت شد', transaction: tx });
    } catch (error) {
        res.status(500).json({ message: 'خطای سرور', error: error.message });
    }
};




// ---------------------------------------------------------------------
// انتقال بین دو کارت
// ---------------------------------------------------------------------
exports.createTransfer = async (req, res) => {
    try {
        const { fromCardId, toCardId, amount, description, date } = req.body;
        const userId = req.user.id;

        if (!Number.isInteger(amount) || amount <= 0) {
            return res.status(400).json({ message: 'مبلغ انتقال باید عدد صحیح و بیشتر از صفر باشد' });
        }
        if (!fromCardId || !toCardId) {
            return res.status(400).json({ message: 'کارت مبدا و مقصد الزامی است' });
        }
        if (String(fromCardId) === String(toCardId)) {
            return res.status(400).json({ message: 'کارت مبدا و مقصد نمی‌تواند یکی باشد' });
        }

        let txDate = new Date();
        if (date) {
            const parsedDate = new Date(date);
            if (isNaN(parsedDate.getTime())) {
                return res.status(400).json({ message: 'تاریخ تراکنش نامعتبر است' });
            }
            if (parsedDate.getTime() > Date.now() + 24 * 60 * 60 * 1000) {
                return res.status(400).json({ message: 'تاریخ تراکنش نمی‌تواند در آینده باشد' });
            }
            txDate = parsedDate;
        }

        const [fromCard, toCard] = await Promise.all([
            Card.findOne({ _id: fromCardId, userId }).lean(),
            Card.findOne({ _id: toCardId, userId }).lean(),
        ]);
        if (!fromCard || !toCard) {
            return res.status(400).json({ message: 'کارت انتخاب‌شده معتبر نیست' });
        }

        const transferId = new mongoose.Types.ObjectId();
        const cleanDesc = description?.trim() || '';

        try {
            const [outTx, inTx] = await Transaction.insertMany([
                {
                    userId, type: 'TRANSFER_OUT', amount,
                    title: `انتقال به ${toCard.name}`,
                    description: cleanDesc,
                    date: txDate, cardId: fromCard._id,
                    category: null, isPaid: true, transferId,
                },
                {
                    userId, type: 'TRANSFER_IN', amount,
                    title: `انتقال از ${fromCard.name}`,
                    description: cleanDesc,
                    date: txDate, cardId: toCard._id,
                    category: null, isPaid: true, transferId,
                },
            ]);

            res.status(201).json({
                message: 'انتقال با موفقیت ثبت شد',
                transfer: { transferId, amount, from: fromCard.name, to: toCard.name },
                transactions: [outTx, inTx],
            });
        } catch (insertError) {
            // جلوگیری از ثبت نیمه‌کاره
            await Transaction.deleteMany({ transferId, userId });
            throw insertError;
        }
    } catch (error) {
        res.status(500).json({ message: 'خطای سرور', error: error.message });
    }
};

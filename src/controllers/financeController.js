const Transaction = require('../models/Transaction');
const Category = require('../models/Category');
const mongoose = require('mongoose');
const CATEGORIES = require('../constants/categories');

const VALID_CATEGORY_IDS = CATEGORIES.map(c => c.id);
const MAX_CUSTOM_CATEGORIES_PER_USER = 30;

// ---------------------------------------------------------------------
// helperهای مشترک برای خلاصه‌ی مالی — از قبل موجود بودن، دست‌نخورده‌ن
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

const computeFinanceSummary = async (userId, from, to) => {
    const stats = await Transaction.aggregate([
        {
            $match: {
                userId: new mongoose.Types.ObjectId(userId),
                ...buildDateMatch(from, to)
            }
        },
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
        totalIncome: income,
        totalExpense: expense,
        activeDebt: loans - installmentsPaid,
        cashBalance: (income + loans) - (expense + installmentsPaid),
        unpaidInstallmentsCount: unpaid.count,
        unpaidInstallmentsAmount: unpaid.totalRemaining
    };
};

// ---------------------------------------------------------------------
// helperهای دسته‌بندی — منبع واحد برای «این category id معتبره یا نه»
// و «label/icon این id چیه»، چه پیش‌فرض باشه چه شخصیِ همون کاربر.
// هر جای دیگه‌ی کنترلر که به دسته‌بندی نیاز داره از همین دو تابع استفاده می‌کنه
// تا هیچ‌وقت منطق دوباره‌نویسی نشه و از هم عقب نیفته.
// ---------------------------------------------------------------------

// یک Map از همه‌ی دسته‌بندی‌های در دسترسِ این کاربر می‌سازه: پیش‌فرض‌ها + شخصی‌های خودش
const getUserCategoryMap = async (userId) => {
    const customCats = await Category.find({ userId }).lean();
    const map = new Map();
    CATEGORIES.forEach(c => map.set(c.id, { label: c.label, icon: c.icon, isCustom: false }));
    customCats.forEach(c => map.set(c.id, { label: c.label, icon: c.icon, isCustom: true }));
    return map;
};

// اعتبارسنجی category ورودی نسبت به همون Map — اگه معتبر نبود null برمی‌گردونه
// (رفتار دقیقاً مثل resolveCategoryId قبلی، فقط حالا شخصی‌ها رو هم می‌شناسه)
const resolveCategoryId = (category, categoryMap) => {
    if (!category) return null;
    return categoryMap.has(category) ? category : null;
};

// وقتی یه دسته‌بندی (مثلاً چون کاربر حذفش کرده) توی Map پیدا نشه، به‌جای کرش یا
// خالی موندن، یه لیبل قابل‌فهم نشون می‌دیم — تراکنش خودش دست‌نخورده می‌مونه
const FALLBACK_CATEGORY_INFO = { label: 'دسته‌بندی حذف‌شده', icon: '❓' };
const lookupCategoryInfo = (categoryId, categoryMap) => {
    if (!categoryId) return null;
    return categoryMap.get(categoryId) || FALLBACK_CATEGORY_INFO;
};

// ثبت تراکنش جدید
exports.addTransaction = async (req, res) => {
    try {
        const { type, amount, title, description, dueDate, loanId, category, date } = req.body;

        if (amount <= 0) {
            return res.status(400).json({ message: 'مبلغ باید بیشتر از صفر باشد' });
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

        // اعتبارسنجی دسته‌بندی نسبت به پیش‌فرض‌ها + دسته‌بندی‌های شخصیِ همین کاربر
        const categoryMap = await getUserCategoryMap(req.user.id);
        const resolvedCategory = resolveCategoryId(category, categoryMap);

        const newTx = await Transaction.create({
            userId: req.user.id,
            type,
            amount,
            title,
            description,
            dueDate,
            date: txDate,
            category: resolvedCategory,
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

        const filter = { userId: req.user.id, ...buildDateMatch(fromDate, toDate) };

        if (search) {
            filter.$or = [
                { title: { $regex: search, $options: 'i' } },
                { description: { $regex: search, $options: 'i' } },
            ];
        }

        const [transactions, totalTransactions, categoryMap] = await Promise.all([
            Transaction.find(filter).sort({ date: -1 }).skip(skip).limit(limit),
            Transaction.countDocuments(filter),
            getUserCategoryMap(req.user.id),
        ]);

        // اضافه کردن اطلاعات دسته‌بندی به هر تراکنش (پیش‌فرض یا شخصی، هر دو)
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

// تحلیل‌گر هوش مصنوعی — از همون helper مشترک استفاده می‌کنه (کل تاریخچه)
exports.calculateUserStats = async (userId) => {
    return computeFinanceSummary(userId);
};

// خلاصه‌ی مالی
exports.getFinanceStats = async (req, res) => {
    try {
        const { from, to } = req.query;
        const summary = await computeFinanceSummary(req.user.id, from, to);
        res.status(200).json({ summary });
    } catch (error) {
        res.status(500).json({ message: 'خطای سرور', error: error.message });
    }
};

// نمودار دایره‌ای بر اساس دسته‌بندی
exports.getCategoryStats = async (req, res) => {
    try {
        const userId = new mongoose.Types.ObjectId(req.user.id);
        const { type, from, to } = req.query;
        const dateMatch = buildDateMatch(from, to);

        if (type === 'INCOME') {
            const incomeAgg = await Transaction.aggregate([
                { $match: { userId, type: 'INCOME', ...dateMatch } },
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

        const match = { userId, category: { $ne: null, $exists: true }, ...dateMatch };
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

// لیست دسته‌بندی‌ها — فرانت ازش می‌خونه. حالا پیش‌فرض‌ها + دسته‌بندی‌های
// شخصیِ همین کاربر رو با هم برمی‌گردونه (isCustom مشخص می‌کنه کدوم مال خودشه)
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

// ✅ ساخت دسته‌بندی شخصی جدید — مثلاً یک راننده «گازوئیل» رو برای خودش اضافه می‌کنه
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

        // جلوگیری از دسته‌بندی تکراری (بدون حساسیت به حروف بزرگ/کوچک)
        const duplicate = await Category.findOne({
            userId: req.user.id,
            label: { $regex: `^${trimmedLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' }
        });
        if (duplicate) {
            return res.status(400).json({ message: 'این دسته‌بندی از قبل وجود دارد' });
        }

        const newCategory = await Category.create({
            userId: req.user.id,
            id: new mongoose.Types.ObjectId().toHexString(), // شناسه‌ی یکتا، مستقل از متن فارسی
            label: trimmedLabel,
            icon: icon && String(icon).trim() ? String(icon).trim() : '📦',
        });

        res.status(201).json({
            message: 'دسته‌بندی با موفقیت ساخته شد',
            category: { id: newCategory.id, label: newCategory.label, icon: newCategory.icon, isCustom: true }
        });
    } catch (error) {
        res.status(500).json({ message: 'خطای سرور', error: error.message });
    }
};

// ✅ حذف دسته‌بندی شخصی — تراکنش‌هایی که قبلاً با این دسته ثبت شدن دست‌نخورده
// می‌مونن، فقط دیگه توی گزارش‌ها به‌جای اسمش «دسته‌بندی حذف‌شده» نشون داده میشه
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
        const { amount, title, description, dueDate, category, date } = req.body;

        if (amount !== undefined && amount <= 0) {
            return res.status(400).json({ message: 'مبلغ باید بیشتر از صفر باشد' });
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

// خروجی CSV
exports.exportTransactionsCSV = async (req, res) => {
    try {
        const search = req.query.search?.trim();
        const fromDate = req.query.from;
        const toDate = req.query.to;

        const filter = { userId: req.user.id, ...buildDateMatch(fromDate, toDate) };

        if (search) {
            filter.$or = [
                { title: { $regex: search, $options: 'i' } },
                { description: { $regex: search, $options: 'i' } },
            ];
        }

        const [transactions, categoryMap] = await Promise.all([
            Transaction.find(filter).sort({ date: -1 }),
            getUserCategoryMap(req.user.id),
        ]);

        const typeLabel = (type) => {
            const map = { INCOME: 'درآمد', EXPENSE: 'خرج', INSTALLMENT: 'قسط', LOAN: 'وام' };
            return map[type] || type;
        };

        const categoryLabel = (catId) => {
            const info = lookupCategoryInfo(catId, categoryMap);
            return info ? `${info.icon} ${info.label}` : '-';
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

// نمای کلی چند ماه اخیر — پایه‌ی نمودار ستونی/لیست ماه‌ها
exports.getMonthlyOverview = async (req, res) => {
    try {
        const userId = new mongoose.Types.ObjectId(req.user.id);
        const monthsCount = Math.min(parseInt(req.query.months) || 6, 24);

        const now = new Date();
        const startRange = new Date(now.getFullYear(), now.getMonth() - (monthsCount - 1), 1);

        const stats = await Transaction.aggregate([
            { $match: { userId, date: { $gte: startRange } } },
            {
                $group: {
                    _id: {
                        year: { $year: '$date' },
                        month: { $month: '$date' },
                        type: '$type'
                    },
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
        ]);

        const monthsMap = {};
        stats.forEach(item => {
            const key = `${item._id.year}-${item._id.month}`;
            if (!monthsMap[key]) {
                monthsMap[key] = { income: 0, expense: 0, loans: 0, installmentsPaid: 0 };
            }
            if (item._id.type === 'INCOME') monthsMap[key].income = item.totalAmount;
            if (item._id.type === 'EXPENSE') monthsMap[key].expense = item.totalAmount;
            if (item._id.type === 'LOAN') monthsMap[key].loans = item.totalAmount;
            if (item._id.type === 'INSTALLMENT') monthsMap[key].installmentsPaid = item.totalAmount;
        });

        const result = [];
        for (let i = 0; i < monthsCount; i++) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const key = `${d.getFullYear()}-${d.getMonth() + 1}`;
            const data = monthsMap[key] || { income: 0, expense: 0, loans: 0, installmentsPaid: 0 };
            const from = new Date(d.getFullYear(), d.getMonth(), 1);
            const to = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59);

            result.push({
                year: d.getFullYear(),
                month: d.getMonth() + 1,
                from,
                to,
                income: data.income,
                expense: data.expense,
                balance: (data.income + data.loans) - (data.expense + data.installmentsPaid)
            });
        }

        result.reverse(); // قدیمی -> جدید

        res.status(200).json({ months: result });
    } catch (error) {
        res.status(500).json({ message: 'خطای سرور', error: error.message });
    }
};

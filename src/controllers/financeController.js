const mongoose = require('mongoose');
const Transaction = require('../models/Transaction');
const Category = require('../models/Category');
const Card = require('../models/Card');
const CATEGORIES = require('../constants/categories');

// ---------------------------------------------------------------------
// ثابت‌ها و سقف‌ها — برای جلوگیری از مصرف زیاد CPU/RAM
// ---------------------------------------------------------------------
const MAX_CUSTOM_CATEGORIES_PER_USER = 30;
const MAX_PAGE_SIZE = 50;
const MAX_PAGE = 1000;
const MAX_CSV_ROWS = 5000;
const DAY_MS = 24 * 60 * 60 * 1000;

const PRESET_INFO = new Map(
    CATEGORIES.map(c => [c.id, { label: c.label, icon: c.icon, isCustom: false }])
);
const FALLBACK_CATEGORY_INFO = { label: 'دسته‌بندی حذف‌شده', icon: '❓' };

const TYPE_LABELS = {
    INCOME: 'درآمد',
    EXPENSE: 'خرج',
    INSTALLMENT: 'قسط',
    LOAN: 'وام',
    GOAL_DEPOSIT: 'واریز به هدف',
    TRANSFER_IN: 'انتقال ورودی',
    TRANSFER_OUT: 'انتقال خروجی',
};

// ---------------------------------------------------------------------
// helperهای عمومی
// ---------------------------------------------------------------------
const isId = (v) => mongoose.isValidObjectId(v);
const oid = (v) => new mongoose.Types.ObjectId(v);
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const serverError = (res, error) =>
    res.status(500).json({ message: 'خطای سرور', error: error.message });

const buildDateMatch = (from, to) => {
    const range = {};
    if (from) {
        const d = new Date(from);
        if (!isNaN(d.getTime())) range.$gte = d;
    }
    if (to) {
        const d = new Date(to);
        if (!isNaN(d.getTime())) {
            d.setHours(23, 59, 59, 999);
            range.$lte = d;
        }
    }
    return Object.keys(range).length ? { date: range } : {};
};

// تاریخ تراکنش: null = نامعتبر، در غیر این صورت Date
const parseTxDate = (value) => {
    if (!value) return new Date();
    const d = new Date(value);
    if (isNaN(d.getTime()) || d.getTime() > Date.now() + DAY_MS) return null;
    return d;
};

// فقط وقتی کارت نیاز باشه کوئری می‌زنه؛ null = کارت ندارد، throw = نامعتبر
const resolveCardId = async (cardId, userId) => {
    if (!cardId) return null;
    if (!isId(cardId)) throw new Error('INVALID_CARD');
    const card = await Card.exists({ _id: cardId, userId });
    if (!card) throw new Error('INVALID_CARD');
    return card._id;
};

// دسته‌بندی: پیش‌فرض‌ها بدون کوئری، شخصی‌ها فقط در صورت نیاز
const resolveCategory = async (category, userId) => {
    if (!category || typeof category !== 'string') return null;
    if (PRESET_INFO.has(category)) return category;
    const custom = await Category.exists({ id: category, userId });
    return custom ? category : null;
};

// اطلاعات نمایشی دسته‌ها؛ فقط برای idهای غیرپیش‌فرض به دیتابیس می‌رود
const loadCategoryInfo = async (userId, ids) => {
    const map = new Map(PRESET_INFO);
    const customIds = [...new Set(ids)].filter(id => id && !PRESET_INFO.has(id));
    if (customIds.length) {
        const customs = await Category.find({ userId, id: { $in: customIds } })
            .select('id label icon').lean();
        customs.forEach(c => map.set(c.id, { label: c.label, icon: c.icon, isCustom: true }));
    }
    return map;
};

const lookupCategoryInfo = (id, map) => {
    if (!id) return null;
    return map.get(id) || FALLBACK_CATEGORY_INFO;
};

// ---------------------------------------------------------------------
// خلاصه مالی — فقط یک aggregate ساده (بدون $facet)
// ---------------------------------------------------------------------
const summaryFromRows = (rows) => {
    const t = {};
    let unpaidAmount = 0, unpaidCount = 0;

    for (const r of rows) {
        const { type, isPaid } = r._id;
        if (type === 'INSTALLMENT') {
            if (isPaid) t.INSTALLMENT = (t.INSTALLMENT || 0) + r.total;
            else { unpaidAmount += r.total; unpaidCount += r.count; }
        } else {
            t[type] = (t[type] || 0) + r.total;
        }
    }

    const income = t.INCOME || 0;
    const expense = t.EXPENSE || 0;
    const loans = t.LOAN || 0;
    const goalDeposits = t.GOAL_DEPOSIT || 0;
    const transferIn = t.TRANSFER_IN || 0;
    const transferOut = t.TRANSFER_OUT || 0;
    const installmentsPaid = t.INSTALLMENT || 0;

    return {
        totalIncome: income,
        totalExpense: expense,
        totalGoalDeposits: goalDeposits,
        totalTransferIn: transferIn,
        totalTransferOut: transferOut,
        activeDebt: unpaidAmount,
        cashBalance: (income + loans + transferIn) - (expense + installmentsPaid + goalDeposits + transferOut),
        unpaidInstallmentsCount: unpaidCount,
        unpaidInstallmentsAmount: unpaidAmount,
    };
};

const SUMMARY_GROUP = {
    $group: {
        _id: { type: '$type', isPaid: '$isPaid' },
        total: { $sum: '$amount' },
        count: { $sum: 1 },
    },
};

const computeFinanceSummary = async (userId, from, to, cardId = null) => {
    const match = { userId: oid(userId), ...buildDateMatch(from, to) };
    if (cardId) match.cardId = oid(cardId);
    const rows = await Transaction.aggregate([{ $match: match }, SUMMARY_GROUP]);
    return summaryFromRows(rows);
};

// استفاده توسط aiController
exports.calculateUserStats = (userId) => computeFinanceSummary(userId);

exports.getFinanceStats = async (req, res) => {
    try {
        const { from, to, cardId } = req.query;
        if (cardId) {
            if (!isId(cardId) || !(await Card.exists({ _id: cardId, userId: req.user.id }))) {
                return res.status(400).json({ message: 'کارت انتخاب‌شده معتبر نیست' });
            }
        }
        const summary = await computeFinanceSummary(req.user.id, from, to, cardId || null);
        res.status(200).json({ summary });
    } catch (error) {
        serverError(res, error);
    }
};

// ---------------------------------------------------------------------
// ثبت تراکنش
// ---------------------------------------------------------------------
exports.addTransaction = async (req, res) => {
    try {
        const { type, amount, title, description, dueDate, loanId, category, date, cardId } = req.body;

        if (!(amount > 0)) {
            return res.status(400).json({ message: 'مبلغ باید بیشتر از صفر باشد' });
        }
        if (type === 'GOAL_DEPOSIT') {
            return res.status(400).json({ message: 'این نوع تراکنش فقط از طریق واریز به هدف قابل ثبت است' });
        }

        const txDate = parseTxDate(date);
        if (!txDate) {
            return res.status(400).json({ message: 'تاریخ تراکنش نامعتبر است یا در آینده است' });
        }

        let resolvedCardId;
        try {
            resolvedCardId = await resolveCardId(cardId, req.user.id);
        } catch {
            return res.status(400).json({ message: 'کارت انتخاب‌شده معتبر نیست' });
        }

        const resolvedCategory = await resolveCategory(category, req.user.id);

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
            loanId: loanId && isId(loanId) ? oid(loanId) : null,
            isPaid: ['LOAN', 'INCOME', 'EXPENSE'].includes(type),
        });

        res.status(201).json({ message: 'تراکنش با موفقیت ثبت شد', transaction: newTx });
    } catch (error) {
        serverError(res, error);
    }
};

// ---------------------------------------------------------------------
// ساخت فیلتر مشترک لیست و CSV — null برگردد یعنی cardId نامعتبر
// ---------------------------------------------------------------------
const buildListFilter = (req) => {
    const filter = { userId: req.user.id, ...buildDateMatch(req.query.from, req.query.to) };

    const { cardId } = req.query;
    if (cardId === 'none') filter.cardId = null;
    else if (cardId) {
        if (!isId(cardId)) return null;
        filter.cardId = oid(cardId);
    }

    const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 50) : '';
    if (search) {
        const rx = { $regex: escapeRegex(search), $options: 'i' };
        filter.$or = [{ title: rx }, { description: rx }];
    }

    if (typeof req.query.type === 'string' && req.query.type) filter.type = req.query.type;
    return filter;
};

// ---------------------------------------------------------------------
// لیست تراکنش‌ها (صفحه‌بندی با سقف)
// ---------------------------------------------------------------------
exports.getMyTransactions = async (req, res) => {
    try {
        const page = Math.min(Math.max(parseInt(req.query.page) || 1, 1), MAX_PAGE);
        const limit = Math.min(Math.max(parseInt(req.query.limit) || 10, 1), MAX_PAGE_SIZE);

        const filter = buildListFilter(req);
        if (!filter) return res.status(400).json({ message: 'کارت انتخاب‌شده معتبر نیست' });

        const [transactions, totalItems] = await Promise.all([
            Transaction.find(filter).sort({ date: -1 }).skip((page - 1) * limit).limit(limit).lean(),
            Transaction.countDocuments(filter),
        ]);

        const categoryMap = await loadCategoryInfo(req.user.id, transactions.map(t => t.category));
        for (const tx of transactions) {
            const info = lookupCategoryInfo(tx.category, categoryMap);
            tx.categoryInfo = info ? { id: tx.category, ...info } : null;
        }

        res.status(200).json({
            currentPage: page,
            totalPages: Math.ceil(totalItems / limit),
            totalItems,
            transactions,
        });
    } catch (error) {
        serverError(res, error);
    }
};

// ---------------------------------------------------------------------
// آمار دسته‌بندی
// ---------------------------------------------------------------------
exports.getCategoryStats = async (req, res) => {
    try {
        const { type, from, to, cardId } = req.query;
        const base = { userId: oid(req.user.id), ...buildDateMatch(from, to) };

        if (cardId) {
            if (!isId(cardId) || !(await Card.exists({ _id: cardId, userId: req.user.id }))) {
                return res.status(400).json({ message: 'کارت انتخاب‌شده معتبر نیست' });
            }
            base.cardId = oid(cardId);
        }

        if (type === 'INCOME') {
            const [agg] = await Transaction.aggregate([
                { $match: { ...base, type: 'INCOME' } },
                { $group: { _id: null, totalAmount: { $sum: '$amount' }, count: { $sum: 1 } } },
            ]);
            const total = agg ? agg.totalAmount : 0;
            const categories = total > 0
                ? [{ id: 'INCOME', label: 'درآمد', icon: '💰', totalAmount: total, count: agg.count, percentage: 100 }]
                : [];
            return res.status(200).json({ total, categories });
        }

        const match = { ...base, category: { $ne: null } };
        if (type) match.type = type;

        const stats = await Transaction.aggregate([
            { $match: match },
            { $group: { _id: '$category', totalAmount: { $sum: '$amount' }, count: { $sum: 1 } } },
            { $sort: { totalAmount: -1 } },
        ]);

        const categoryMap = await loadCategoryInfo(req.user.id, stats.map(s => s._id));
        const total = stats.reduce((sum, s) => sum + s.totalAmount, 0);

        const categories = stats.map(item => {
            const info = lookupCategoryInfo(item._id, categoryMap) || FALLBACK_CATEGORY_INFO;
            return {
                id: item._id,
                label: info.label,
                icon: info.icon,
                totalAmount: item.totalAmount,
                count: item.count,
                percentage: total > 0 ? Math.round((item.totalAmount / total) * 100) : 0,
            };
        });

        res.status(200).json({ total, categories });
    } catch (error) {
        serverError(res, error);
    }
};

// ---------------------------------------------------------------------
// دسته‌بندی‌ها
// ---------------------------------------------------------------------
exports.getCategories = async (req, res) => {
    try {
        const customs = await Category.find({ userId: req.user.id }).select('id label icon').lean();
        const presets = CATEGORIES.map(c => ({ ...c, isCustom: false }));
        const custom = customs.map(c => ({ id: c.id, label: c.label, icon: c.icon, isCustom: true }));
        res.status(200).json({ categories: [...presets, ...custom] });
    } catch (error) {
        serverError(res, error);
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

        // یک کوئری برای هم شمارش و هم تکراری‌بودن (حداکثر ۳۰ سند)
        const existing = await Category.find({ userId: req.user.id }).select('label').lean();
        if (existing.length >= MAX_CUSTOM_CATEGORIES_PER_USER) {
            return res.status(400).json({ message: `حداکثر ${MAX_CUSTOM_CATEGORIES_PER_USER} دسته‌بندی شخصی مجاز است` });
        }
        const lower = trimmedLabel.toLowerCase();
        if (existing.some(c => String(c.label).toLowerCase() === lower)) {
            return res.status(400).json({ message: 'این دسته‌بندی از قبل وجود دارد' });
        }

        const created = await Category.create({
            userId: req.user.id,
            id: new mongoose.Types.ObjectId().toHexString(),
            label: trimmedLabel,
            icon: icon && String(icon).trim() ? String(icon).trim() : '',
        });

        res.status(201).json({
            message: 'دسته‌بندی با موفقیت ساخته شد',
            category: { id: created.id, label: created.label, icon: created.icon, isCustom: true },
        });
    } catch (error) {
        serverError(res, error);
    }
};

exports.deleteCustomCategory = async (req, res) => {
    try {
        const deleted = await Category.findOneAndDelete({ id: req.params.id, userId: req.user.id }).select('_id').lean();
        if (!deleted) {
            return res.status(404).json({ message: 'دسته‌بندی مورد نظر یافت نشد' });
        }
        res.status(200).json({ message: 'دسته‌بندی با موفقیت حذف شد' });
    } catch (error) {
        serverError(res, error);
    }
};

// ---------------------------------------------------------------------
// پرداخت قسط (atomic)
// ---------------------------------------------------------------------
exports.payInstallment = async (req, res) => {
    try {
        const installmentId = req.params.id;
        if (!isId(installmentId)) {
            return res.status(404).json({ message: 'قسط مورد نظر یافت نشد' });
        }

        const update = { isPaid: true, date: new Date() };
        const { cardId } = req.body;
        if (cardId !== undefined) {
            try {
                update.cardId = await resolveCardId(cardId, req.user.id);
            } catch {
                return res.status(400).json({ message: 'کارت انتخاب‌شده معتبر نیست' });
            }
        }

        const updated = await Transaction.findOneAndUpdate(
            { _id: installmentId, userId: req.user.id, type: 'INSTALLMENT', isPaid: false },
            update,
            { new: true }
        ).lean();

        if (!updated) {
            const exists = await Transaction.exists({ _id: installmentId, userId: req.user.id, type: 'INSTALLMENT' });
            if (!exists) return res.status(404).json({ message: 'قسط مورد نظر یافت نشد' });
            return res.status(400).json({ message: 'این قسط قبلاً پرداخت شده است' });
        }

        res.status(200).json({ message: 'قسط با موفقیت پرداخت شد', installment: updated });
    } catch (error) {
        serverError(res, error);
    }
};

// ---------------------------------------------------------------------
// ویرایش تراکنش — بدون کوئری اضافه؛ قفل تراکنش انتقال داخل خود فیلتر است
// ---------------------------------------------------------------------
exports.updateTransaction = async (req, res) => {
    try {
        const { id } = req.params;
        if (!isId(id)) {
            return res.status(404).json({ message: 'تراکنش مورد نظر یافت نشد' });
        }

        const { amount, title, description, dueDate, category, date, cardId } = req.body;

        if (amount !== undefined && !(amount > 0)) {
            return res.status(400).json({ message: 'مبلغ باید بیشتر از صفر باشد' });
        }

        const update = {};
        if (amount !== undefined) update.amount = amount;
        if (title !== undefined) update.title = title;
        if (description !== undefined) update.description = description;
        if (dueDate !== undefined) update.dueDate = dueDate;

        if (category !== undefined) {
            update.category = await resolveCategory(category, req.user.id);
        }

        if (date !== undefined) {
            const d = parseTxDate(date);
            if (!d) return res.status(400).json({ message: 'تاریخ تراکنش نامعتبر است یا در آینده است' });
            update.date = d;
        }

        if (cardId !== undefined) {
            try {
                update.cardId = await resolveCardId(cardId, req.user.id);
            } catch {
                return res.status(400).json({ message: 'کارت انتخاب‌شده معتبر نیست' });
            }
        }

        const filter = { _id: id, userId: req.user.id };
        const touchesTransferFields = amount !== undefined || cardId !== undefined;
        if (touchesTransferFields) filter.transferId = null; // انتقال‌ها مبلغ/کارتشان قابل تغییر نیست

        const updated = await Transaction.findOneAndUpdate(filter, update, { new: true, runValidators: true }).lean();

        if (!updated) {
            const existing = await Transaction.findOne({ _id: id, userId: req.user.id }).select('_id').lean();
            if (!existing) return res.status(404).json({ message: 'تراکنش مورد نظر یافت نشد' });
            return res.status(400).json({
                message: 'مبلغ و کارت انتقال قابل ویرایش نیست؛ انتقال را حذف و دوباره ثبت کن',
            });
        }

        res.status(200).json({ message: 'تراکنش با موفقیت ویرایش شد', transaction: updated });
    } catch (error) {
        serverError(res, error);
    }
};

// ---------------------------------------------------------------------
// حذف تراکنش
// ---------------------------------------------------------------------
exports.deleteTransaction = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;
        if (!isId(id)) {
            return res.status(404).json({ message: 'تراکنش مورد نظر یافت نشد' });
        }

        const tx = await Transaction.findOne({ _id: id, userId }).select('type transferId').lean();
        if (!tx) {
            return res.status(404).json({ message: 'تراکنش مورد نظر یافت نشد' });
        }

        if (tx.transferId) {
            await Transaction.deleteMany({ transferId: tx.transferId, userId });
        } else if (tx.type === 'LOAN') {
            await Transaction.deleteMany({ $or: [{ _id: tx._id }, { loanId: tx._id }], userId });
        } else {
            await Transaction.deleteOne({ _id: tx._id });
        }

        res.status(200).json({ message: 'تراکنش با موفقیت حذف شد' });
    } catch (error) {
        serverError(res, error);
    }
};

// ---------------------------------------------------------------------
// مقایسه ماه جاری با ماه قبل — یک aggregate برای هر دو ماه
// ---------------------------------------------------------------------
exports.getMonthlyComparison = async (req, res) => {
    try {
        const now = new Date();
        const curStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const curEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
        const prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);

        const rows = await Transaction.aggregate([
            { $match: { userId: oid(req.user.id), date: { $gte: prevStart, $lte: curEnd } } },
            {
                $group: {
                    _id: {
                        cur: { $gte: ['$date', curStart] },
                        type: '$type',
                        isPaid: '$isPaid',
                    },
                    total: { $sum: '$amount' },
                    count: { $sum: 1 },
                },
            },
        ]);

        const split = (isCur) => summaryFromRows(
            rows.filter(r => r._id.cur === isCur)
                .map(r => ({ _id: { type: r._id.type, isPaid: r._id.isPaid }, total: r.total, count: r.count }))
        );
        const current = split(true);
        const previous = split(false);

        const change = (curr, prev) => {
            if (prev === 0) return curr > 0 ? 100 : 0;
            return Math.round(((curr - prev) / prev) * 100);
        };
        const pick = (s) => ({ income: s.totalIncome, expense: s.totalExpense, cashBalance: s.cashBalance });

        res.status(200).json({
            current: pick(current),
            previous: pick(previous),
            changes: {
                income: change(current.totalIncome, previous.totalIncome),
                expense: change(current.totalExpense, previous.totalExpense),
                cashBalance: change(current.cashBalance, previous.cashBalance),
            },
        });
    } catch (error) {
        serverError(res, error);
    }
};

// ---------------------------------------------------------------------
// خروجی CSV — سقف ردیف، lean، فرمتر تاریخ یک‌بار ساخته می‌شود
// ---------------------------------------------------------------------
const csvCell = (val) => `"${String(val ?? '').replace(/"/g, '""')}"`;

exports.exportTransactionsCSV = async (req, res) => {
    try {
        const filter = buildListFilter(req);
        if (!filter) return res.status(400).json({ message: 'کارت انتخاب‌شده معتبر نیست' });
        delete filter.type; // رفتار قبلی: CSV فیلتر نوع نداشت

        const [transactions, cards] = await Promise.all([
            Transaction.find(filter)
                .select('title type category cardId amount description date isPaid')
                .sort({ date: -1 })
                .limit(MAX_CSV_ROWS)
                .lean(),
            Card.find({ userId: req.user.id }).select('name').lean(),
        ]);

        const categoryMap = await loadCategoryInfo(req.user.id, transactions.map(t => t.category));
        const cardNames = new Map(cards.map(c => [String(c._id), c.name]));

        const dateFmt = new Intl.DateTimeFormat('fa-IR');
        const dateCache = new Map(); // کش بر اساس روز — فرمت تاریخ گران است
        const fmtDate = (d) => {
            const t = new Date(d);
            const key = Math.floor(t.getTime() / DAY_MS);
            let s = dateCache.get(key);
            if (s === undefined) { s = dateFmt.format(t); dateCache.set(key, s); }
            return s;
        };

        const lines = ['ردیف,عنوان,نوع,دسته‌بندی,کارت,مبلغ (ریال),توضیحات,تاریخ,وضعیت پرداخت'];
        transactions.forEach((tx, i) => {
            const info = lookupCategoryInfo(tx.category, categoryMap);
            const paid = tx.type === 'INSTALLMENT' ? (tx.isPaid ? 'پرداخت شده' : 'پرداخت نشده') : '-';
            lines.push([
                i + 1,
                csvCell(tx.title),
                csvCell(TYPE_LABELS[tx.type] || tx.type),
                csvCell(info ? `${info.icon} ${info.label}` : '-'),
                csvCell(tx.cardId ? (cardNames.get(String(tx.cardId)) || '-') : '-'),
                tx.amount,
                csvCell(tx.description || ''),
                csvCell(fmtDate(tx.date)),
                csvCell(paid),
            ].join(','));
        });

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="sablo-transactions-${Date.now()}.csv"`);
        res.status(200).send('﻿' + lines.join('\n'));
    } catch (error) {
        serverError(res, error);
    }
};

// ---------------------------------------------------------------------
// نمای کلی چند ماه اخیر
// ---------------------------------------------------------------------
exports.getMonthlyOverview = async (req, res) => {
    try {
        const userId = oid(req.user.id);
        const monthsCount = Math.min(Math.max(parseInt(req.query.months) || 6, 1), 24);

        const now = new Date();
        const startRange = new Date(now.getFullYear(), now.getMonth() - (monthsCount - 1), 1);
        const match = { userId, date: { $gte: startRange } };

        const { cardId } = req.query;
        if (cardId) {
            if (!isId(cardId) || !(await Card.exists({ _id: cardId, userId: req.user.id }))) {
                return res.status(400).json({ message: 'کارت انتخاب‌شده معتبر نیست' });
            }
            match.cardId = oid(cardId);
        }

        const stats = await Transaction.aggregate([
            { $match: match },
            {
                $group: {
                    _id: { year: { $year: '$date' }, month: { $month: '$date' }, type: '$type' },
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

        const byMonth = new Map();
        for (const { _id, totalAmount } of stats) {
            const key = `${_id.year}-${_id.month}`;
            let m = byMonth.get(key);
            if (!m) { m = {}; byMonth.set(key, m); }
            m[_id.type] = totalAmount;
        }

        const months = [];
        for (let i = monthsCount - 1; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const m = byMonth.get(`${d.getFullYear()}-${d.getMonth() + 1}`) || {};
            const g = (k) => m[k] || 0;

            months.push({
                year: d.getFullYear(),
                month: d.getMonth() + 1,
                from: d,
                to: new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59),
                income: g('INCOME'),
                expense: g('EXPENSE'),
                transferIn: g('TRANSFER_IN'),
                transferOut: g('TRANSFER_OUT'),
                balance: (g('INCOME') + g('LOAN') + g('TRANSFER_IN')) -
                    (g('EXPENSE') + g('INSTALLMENT') + g('GOAL_DEPOSIT') + g('TRANSFER_OUT')),
            });
        }

        res.status(200).json({ months });
    } catch (error) {
        serverError(res, error);
    }
};

// ---------------------------------------------------------------------
// ساخت وام + اقساط (تاریخ‌ها از فرانت می‌آید)
// ---------------------------------------------------------------------
exports.createLoanWithInstallments = async (req, res) => {
    try {
        const { title, totalAmount, installmentCount, installmentAmount, installmentDates, description, cardId } = req.body;
        const count = Number(installmentCount);

        if (!title || !String(title).trim()) {
            return res.status(400).json({ message: 'نام وام الزامی است' });
        }
        if (!(totalAmount > 0)) {
            return res.status(400).json({ message: 'مبلغ کل وام باید بیشتر از صفر باشد' });
        }
        if (!Number.isInteger(count) || count < 1 || count > 360) {
            return res.status(400).json({ message: 'تعداد اقساط باید بین ۱ تا ۳۶۰ باشد' });
        }
        if (!(installmentAmount > 0)) {
            return res.status(400).json({ message: 'مبلغ هر قسط باید بیشتر از صفر باشد' });
        }
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

        let resolvedCardId;
        try {
            resolvedCardId = await resolveCardId(cardId, req.user.id);
        } catch {
            return res.status(400).json({ message: 'کارت انتخاب‌شده معتبر نیست' });
        }

        const now = new Date();
        const firstDueDate = dueDates[0];
        const lastDueDate = dueDates[count - 1];
        const cleanTitle = String(title).trim();

        const loanTx = await Transaction.create({
            userId: req.user.id,
            type: 'LOAN',
            amount: totalAmount,
            title: cleanTitle,
            description: description?.trim?.() || '',
            date: now,
            dueDate: lastDueDate,
            isPaid: true,
            loanId: null,
            category: null,
            cardId: resolvedCardId,
        });

        try {
            await Transaction.insertMany(dueDates.map((dueDate, i) => ({
                userId: req.user.id,
                type: 'INSTALLMENT',
                amount: installmentAmount,
                title: `${cleanTitle} — قسط ${i + 1} از ${count}`,
                description: '',
                date: now,
                dueDate,
                isPaid: false,
                loanId: loanTx._id,
                category: null,
                cardId: resolvedCardId,
            })), { lean: true });
        } catch (insertError) {
            await Transaction.deleteOne({ _id: loanTx._id }); // وام نیمه‌کاره نماند
            throw insertError;
        }

        res.status(201).json({
            message: `وام با ${count} قسط با موفقیت ثبت شد`,
            loan: {
                _id: loanTx._id,
                title: loanTx.title,
                totalAmount,
                installmentCount: count,
                installmentAmount,
                firstDueDate,
                lastDueDate,
                cardId: resolvedCardId,
            },
        });
    } catch (error) {
        serverError(res, error);
    }
};

// ---------------------------------------------------------------------
// لیست وام‌ها — یک گذر روی اقساط
// ---------------------------------------------------------------------
exports.getLoans = async (req, res) => {
    try {
        const userId = req.user.id;

        const loans = await Transaction.find({ userId, type: 'LOAN' })
            .select('title description date cardId amount')
            .sort({ date: -1 })
            .lean();

        if (loans.length === 0) {
            return res.status(200).json({ loans: [] });
        }

        const [installments, cards] = await Promise.all([
            Transaction.find({ userId, type: 'INSTALLMENT', loanId: { $in: loans.map(l => l._id) } })
                .select('title amount dueDate isPaid date loanId')
                .sort({ dueDate: 1 })
                .lean(),
            Card.find({ userId }).select('name icon color').lean(),
        ]);

        const byLoan = new Map();
        for (const inst of installments) {
            const key = String(inst.loanId);
            const arr = byLoan.get(key);
            if (arr) arr.push(inst); else byLoan.set(key, [inst]);
        }

        const cardMap = new Map(cards.map(c => [String(c._id), { name: c.name, icon: c.icon, color: c.color }]));

        const result = loans.map(loan => {
            const insts = byLoan.get(String(loan._id)) || [];
            let paid = 0, paidAmount = 0, totalAmount = 0, next = null;
            for (const i of insts) {
                totalAmount += i.amount;
                if (i.isPaid) { paid++; paidAmount += i.amount; }
                else if (!next) next = i;
            }
            const total = insts.length;

            return {
                _id: loan._id,
                title: loan.title,
                description: loan.description,
                date: loan.date,
                cardId: loan.cardId,
                cardInfo: loan.cardId ? (cardMap.get(String(loan.cardId)) || null) : null,
                totalLoanAmount: loan.amount,
                totalAmount,
                paidAmount,
                remainingAmount: totalAmount - paidAmount,
                installmentCount: total,
                paidCount: paid,
                unpaidCount: total - paid,
                progressPercent: total > 0 ? Math.round((paid / total) * 100) : 0,
                isFullyPaid: total > 0 && paid === total,
                nextInstallment: next
                    ? { _id: next._id, amount: next.amount, dueDate: next.dueDate, title: next.title }
                    : null,
                installments: insts.map(i => ({
                    _id: i._id, title: i.title, amount: i.amount, dueDate: i.dueDate, isPaid: i.isPaid, date: i.date,
                })),
            };
        });

        res.status(200).json({ loans: result });
    } catch (error) {
        serverError(res, error);
    }
};

exports.getUnpaidInstallments = async (req, res) => {
    try {
        const since = new Date(Date.now() - DAY_MS);

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
        serverError(res, error);
    }
};

// ---------------------------------------------------------------------
// انتقال بین دو کارت — یک کوئری برای هر دو کارت
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
        if (!isId(fromCardId) || !isId(toCardId)) {
            return res.status(400).json({ message: 'کارت انتخاب‌شده معتبر نیست' });
        }

        const txDate = parseTxDate(date);
        if (!txDate) {
            return res.status(400).json({ message: 'تاریخ تراکنش نامعتبر است یا در آینده است' });
        }

        const found = await Card.find({ _id: { $in: [fromCardId, toCardId] }, userId }).select('name').lean();
        const fromCard = found.find(c => String(c._id) === String(fromCardId));
        const toCard = found.find(c => String(c._id) === String(toCardId));
        if (!fromCard || !toCard) {
            return res.status(400).json({ message: 'کارت انتخاب‌شده معتبر نیست' });
        }

        const transferId = new mongoose.Types.ObjectId();
        const desc = description?.trim?.() || '';

        try {
            const [outTx, inTx] = await Transaction.insertMany([
                {
                    userId, type: 'TRANSFER_OUT', amount,
                    title: `انتقال به ${toCard.name}`, description: desc,
                    date: txDate, cardId: fromCard._id, category: null, isPaid: true, transferId,
                },
                {
                    userId, type: 'TRANSFER_IN', amount,
                    title: `انتقال از ${fromCard.name}`, description: desc,
                    date: txDate, cardId: toCard._id, category: null, isPaid: true, transferId,
                },
            ]);

            res.status(201).json({
                message: 'انتقال با موفقیت ثبت شد',
                transfer: { transferId, amount, from: fromCard.name, to: toCard.name },
                transactions: [outTx, inTx],
            });
        } catch (insertError) {
            await Transaction.deleteMany({ transferId, userId }); // ثبت نیمه‌کاره نماند
            throw insertError;
        }
    } catch (error) {
        serverError(res, error);
    }
};

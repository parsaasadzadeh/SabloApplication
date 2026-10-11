const Transaction = require('../models/Transaction');
const Category = require('../models/Category');
const Card = require('../models/Card');
const mongoose = require('mongoose');
const CATEGORIES = require('../constants/categories');
const { calculateDong: computeDong } = require('../utils/dongCalculator');

// ---------------------------------------------------------------------
// محدودیت‌ها — همه اعداد اینجا جمع شده‌اند تا راحت عوض شوند
// ---------------------------------------------------------------------
const LIMITS = {
    PAGE_SIZE_MAX: 20,            // حداکثر آیتم در هر صفحه
    PAGE_MAX: 100,                // حداکثر شماره صفحه
    COUNT_CAP: 2000,              // شمارش کل از این عدد جلوتر نمی‌رود
    SEARCH_MIN: 2,
    SEARCH_MAX: 30,
    TITLE_MAX: 100,
    DESC_MAX: 300,
    AMOUNT_MAX: 1e13,
    RANGE_MAX_DAYS: 366,          // حداکثر بازه تاریخ برای آمار/خروجی
    CSV_MAX_ROWS: 1000,
    CSV_CHUNK: 200,
    MONTHS_MAX: 12,
    CATEGORY_SLICES_MAX: 15,
    LOANS_PAGE_SIZE: 10,
    LOANS_PAGE_MAX: 20,
    INSTALLMENTS_MAX: 120,        // حداکثر قسط هر وام
    LOANS_MAX_PER_USER: 20,
    UNPAID_MAX: 50,
    CUSTOM_CATEGORIES_MAX: 30,
    DONG_PARTICIPANTS_MAX: 15,
    DONG_PAID_MAX: 1e12,
    DONG_WEIGHT_MAX: 100,
    QUERY_MAX_MS: 4000,
    HEAVY_CONCURRENCY: 2,         // حداکثر کار سنگین همزمان در هر پروسه
    STATS_TTL_MS: 20_000,
    CATEGORY_TTL_MS: 60_000,
};

const DAY_MS = 24 * 60 * 60 * 1000;
const VALID_TYPES = ['INCOME', 'EXPENSE', 'INSTALLMENT', 'LOAN', 'GOAL_DEPOSIT', 'TRANSFER_IN', 'TRANSFER_OUT'];
const MANUAL_TYPES = ['INCOME', 'EXPENSE', 'INSTALLMENT', 'LOAN'];

// ---------------------------------------------------------------------
// ابزارهای کوچک
// ---------------------------------------------------------------------
const clamp = (n, min, max) => Math.min(Math.max(n, min), max);
const asStr = (v) => (typeof v === 'string' ? v : undefined); // جلوگیری از آبجکت در query
const isValidId = (id) => typeof id === 'string' && mongoose.Types.ObjectId.isValid(id);
const oid = (id) => new mongoose.Types.ObjectId(String(id));
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const isMoney = (n) => typeof n === 'number' && Number.isFinite(n) && n > 0 && n <= LIMITS.AMOUNT_MAX;
const tooLong = (v, max) => String(v ?? '').length > max;

const fail = (res, error) =>
    res.status(500).json({
        message: 'خطای سرور',
        error: process.env.NODE_ENV === 'production' ? undefined : error.message,
    });

// بازه تاریخ: اگر نیامد، ۳۶۶ روز اخیر؛ اگر بزرگ‌تر از سقف بود، null
const normalizeRange = (from, to) => {
    const f = asStr(from);
    const t = asStr(to);
    const end = t ? new Date(t) : new Date();
    if (isNaN(end.getTime())) return null;
    end.setHours(23, 59, 59, 999);
    const start = f ? new Date(f) : new Date(end.getTime() - LIMITS.RANGE_MAX_DAYS * DAY_MS);
    if (isNaN(start.getTime()) || start > end) return null;
    if (end - start > LIMITS.RANGE_MAX_DAYS * DAY_MS) return null;
    return { start, end };
};

const dateMatch = (range) => (range ? { date: { $gte: range.start, $lte: range.end } } : {});

// تاریخ تراکنش: نه نامعتبر، نه بیش از یک روز در آینده
const parseTxDate = (date) => {
    const d = new Date(date);
    if (isNaN(d.getTime())) return { error: 'تاریخ تراکنش نامعتبر است' };
    if (d.getTime() > Date.now() + DAY_MS) return { error: 'تاریخ تراکنش نمی‌تواند در آینده باشد' };
    return { value: d };
};

// ---------------------------------------------------------------------
// گیت همزمانی برای کارهای سنگین
// ---------------------------------------------------------------------
let heavyActive = 0;
const heavy = (handler) => async (req, res) => {
    if (heavyActive >= LIMITS.HEAVY_CONCURRENCY) {
        res.setHeader('Retry-After', '5');
        return res.status(503).json({ message: 'سرور شلوغ است، چند ثانیه بعد دوباره تلاش کن' });
    }
    heavyActive++;
    try {
        await handler(req, res);
    } finally {
        heavyActive--;
    }
};

// ---------------------------------------------------------------------
// کش درون‌حافظه‌ای کوتاه‌مدت (آمار + دسته‌بندی)
// ---------------------------------------------------------------------
const statsCache = new Map();
const userVersion = new Map();

const invalidateUser = (userId) => {
    const k = String(userId);
    if (userVersion.size > 5000) {
        userVersion.clear();
        statsCache.clear();
    }
    userVersion.set(k, (userVersion.get(k) || 0) + 1);
};

const cached = async (userId, name, params, producer) => {
    const uid = String(userId);
    const key = `${uid}|${userVersion.get(uid) || 0}|${name}|${JSON.stringify(params)}`;
    const hit = statsCache.get(key);
    if (hit && hit.exp > Date.now()) return hit.value;
    const value = await producer();
    if (statsCache.size > 1000) statsCache.clear();
    statsCache.set(key, { value, exp: Date.now() + LIMITS.STATS_TTL_MS });
    return value;
};

const catCache = new Map();
const invalidateCategories = (userId) => catCache.delete(String(userId));

const getUserCategoryMap = async (userId) => {
    const key = String(userId);
    const hit = catCache.get(key);
    if (hit && hit.exp > Date.now()) return hit.map;

    const customCats = await Category.find({ userId })
        .select('id label icon')
        .limit(LIMITS.CUSTOM_CATEGORIES_MAX + 20)
        .lean()
        .maxTimeMS(LIMITS.QUERY_MAX_MS);

    const map = new Map();
    CATEGORIES.forEach(c => map.set(c.id, { label: c.label, icon: c.icon, isCustom: false }));
    customCats.forEach(c => map.set(c.id, { label: c.label, icon: c.icon, isCustom: true }));

    if (catCache.size > 2000) catCache.clear();
    catCache.set(key, { map, exp: Date.now() + LIMITS.CATEGORY_TTL_MS });
    return map;
};

const resolveCategoryId = (category, categoryMap) => {
    if (!category || typeof category !== 'string') return null;
    return categoryMap.has(category) ? category : null;
};

const FALLBACK_CATEGORY_INFO = { label: 'دسته‌بندی حذف‌شده', icon: '❓' };
const lookupCategoryInfo = (categoryId, categoryMap) => {
    if (!categoryId) return null;
    return categoryMap.get(categoryId) || FALLBACK_CATEGORY_INFO;
};

// ---------------------------------------------------------------------
// کارت: null = بدون کارت (مجاز)، throw = نامعتبر
// ---------------------------------------------------------------------
const resolveCardId = async (cardId, userId) => {
    if (!cardId) return null;
    if (!isValidId(String(cardId))) throw new Error('INVALID_CARD');
    const card = await Card.findOne({ _id: cardId, userId }).select('_id').lean();
    if (!card) throw new Error('INVALID_CARD');
    return card._id;
};

const parseCard = async (raw, userId) => {
    try {
        return { id: await resolveCardId(raw, userId) };
    } catch {
        return { error: true };
    }
};

const INVALID_CARD_MSG = { message: 'کارت انتخاب‌شده معتبر نیست' };

// ---------------------------------------------------------------------
// محاسبات مالی
// ---------------------------------------------------------------------
const AMOUNT_EXPR = {
    $cond: [
        { $eq: ['$type', 'INSTALLMENT'] },
        { $cond: ['$isPaid', '$amount', 0] },
        '$amount',
    ],
};

const computeFinanceSummary = async (userId, range, cardId = null) => {
    const match = { userId: oid(userId), ...dateMatch(range) };
    if (cardId) match.cardId = oid(cardId);

    const stats = await Transaction.aggregate([
        { $match: match },
        {
            $facet: {
                totals: [{ $group: { _id: '$type', totalAmount: { $sum: AMOUNT_EXPR } } }],
                unpaidInstallments: [
                    { $match: { type: 'INSTALLMENT', isPaid: false } },
                    { $group: { _id: null, totalRemaining: { $sum: '$amount' }, count: { $sum: 1 } } },
                ],
            },
        },
    ]).option({ maxTimeMS: LIMITS.QUERY_MAX_MS });

    const t = {};
    (stats[0]?.totals || []).forEach(i => { t[i._id] = i.totalAmount; });
    const unpaid = stats[0]?.unpaidInstallments?.[0] || { totalRemaining: 0, count: 0 };

    const income = t.INCOME || 0;
    const expense = t.EXPENSE || 0;
    const loans = t.LOAN || 0;
    const installmentsPaid = t.INSTALLMENT || 0;
    const goalDeposits = t.GOAL_DEPOSIT || 0;
    const transferIn = t.TRANSFER_IN || 0;
    const transferOut = t.TRANSFER_OUT || 0;

    return {
        totalIncome: income,
        totalExpense: expense,
        totalGoalDeposits: goalDeposits,
        totalTransferIn: transferIn,
        totalTransferOut: transferOut,
        activeDebt: unpaid.totalRemaining,
        cashBalance: (income + loans + transferIn) - (expense + installmentsPaid + goalDeposits + transferOut),
        unpaidInstallmentsCount: unpaid.count,
        unpaidInstallmentsAmount: unpaid.totalRemaining,
    };
};

const emptyMonth = () => ({
    INCOME: 0, EXPENSE: 0, LOAN: 0, INSTALLMENT: 0,
    GOAL_DEPOSIT: 0, TRANSFER_IN: 0, TRANSFER_OUT: 0,
});

const monthBalance = (d) =>
    (d.INCOME + d.LOAN + d.TRANSFER_IN) - (d.EXPENSE + d.INSTALLMENT + d.GOAL_DEPOSIT + d.TRANSFER_OUT);

// یک aggregate مشترک برای نمای کلی و مقایسه ماهانه
const monthlyTotals = async (userId, start, end, cardId) => {
    const match = { userId: oid(userId), date: { $gte: start, $lte: end } };
    if (cardId) match.cardId = cardId;

    const rows = await Transaction.aggregate([
        { $match: match },
        {
            $group: {
                _id: { y: { $year: '$date' }, m: { $month: '$date' }, type: '$type' },
                total: { $sum: AMOUNT_EXPR },
            },
        },
    ]).option({ maxTimeMS: LIMITS.QUERY_MAX_MS });

    const map = {};
    rows.forEach(r => {
        const key = `${r._id.y}-${r._id.m}`;
        if (!map[key]) map[key] = emptyMonth();
        if (r._id.type in map[key]) map[key][r._id.type] = r.total;
    });
    return map;
};

// ---------------------------------------------------------------------
// ثبت تراکنش جدید
// ---------------------------------------------------------------------
exports.addTransaction = async (req, res) => {
    try {
        const { type, amount, title, description, dueDate, loanId, category, date, cardId } = req.body;

        if (type === 'GOAL_DEPOSIT') {
            return res.status(400).json({ message: 'این نوع تراکنش فقط از طریق واریز به هدف قابل ثبت است' });
        }
        if (!MANUAL_TYPES.includes(type)) {
            return res.status(400).json({ message: 'نوع تراکنش نامعتبر است' });
        }
        if (!isMoney(amount)) {
            return res.status(400).json({ message: 'مبلغ باید بیشتر از صفر باشد' });
        }
        if (tooLong(title, LIMITS.TITLE_MAX) || tooLong(description, LIMITS.DESC_MAX)) {
            return res.status(400).json({ message: 'متن خیلی طولانی است' });
        }
        if (loanId && !isValidId(String(loanId))) {
            return res.status(400).json({ message: 'شناسه وام نامعتبر است' });
        }

        let txDate = new Date();
        if (date) {
            const p = parseTxDate(date);
            if (p.error) return res.status(400).json({ message: p.error });
            txDate = p.value;
        }

        const [categoryMap, card] = await Promise.all([
            getUserCategoryMap(req.user.id),
            parseCard(cardId, req.user.id),
        ]);
        if (card.error) return res.status(400).json(INVALID_CARD_MSG);

        const newTx = await Transaction.create({
            userId: req.user.id,
            type,
            amount,
            title,
            description,
            dueDate,
            date: txDate,
            category: resolveCategoryId(category, categoryMap),
            cardId: card.id,
            loanId: loanId ? oid(loanId) : null,
            isPaid: ['LOAN', 'INCOME', 'EXPENSE'].includes(type),
        });

        invalidateUser(req.user.id);
        res.status(201).json({ message: 'تراکنش با موفقیت ثبت شد', transaction: newTx });
    } catch (error) {
        fail(res, error);
    }
};

// ---------------------------------------------------------------------
// لیست تراکنش‌ها
// ---------------------------------------------------------------------
exports.getMyTransactions = async (req, res) => {
    try {
        const page = clamp(parseInt(req.query.page) || 1, 1, LIMITS.PAGE_MAX);
        const limit = clamp(parseInt(req.query.limit) || 10, 1, LIMITS.PAGE_SIZE_MAX);
        const skip = (page - 1) * limit;

        const filter = { userId: req.user.id };

        if (req.query.from || req.query.to) {
            const range = normalizeRange(req.query.from, req.query.to);
            if (!range) {
                return res.status(400).json({ message: `بازه تاریخ نامعتبر است (حداکثر ${LIMITS.RANGE_MAX_DAYS} روز)` });
            }
            Object.assign(filter, dateMatch(range));
        }

        const cardQ = asStr(req.query.cardId);
        if (cardQ === 'none') {
            filter.cardId = null;
        } else if (cardQ) {
            if (!isValidId(cardQ)) return res.status(400).json(INVALID_CARD_MSG);
            filter.cardId = oid(cardQ);
        }

        const typeQ = asStr(req.query.type);
        if (typeQ && VALID_TYPES.includes(typeQ)) filter.type = typeQ;

        const search = asStr(req.query.search)?.trim();
        if (search && search.length >= LIMITS.SEARCH_MIN) {
            const rx = escapeRegex(search.slice(0, LIMITS.SEARCH_MAX));
            filter.$or = [
                { title: { $regex: rx, $options: 'i' } },
                { description: { $regex: rx, $options: 'i' } },
            ];
        }

        const [transactions, counted, categoryMap] = await Promise.all([
            Transaction.find(filter)
                .select('-__v')
                .sort({ date: -1 })
                .skip(skip)
                .limit(limit)
                .lean()
                .maxTimeMS(LIMITS.QUERY_MAX_MS),
            Transaction.countDocuments(filter).limit(LIMITS.COUNT_CAP).maxTimeMS(LIMITS.QUERY_MAX_MS),
            getUserCategoryMap(req.user.id),
        ]);

        const enriched = transactions.map(tx => {
            const info = lookupCategoryInfo(tx.category, categoryMap);
            tx.categoryInfo = info ? { id: tx.category, ...info } : null;
            return tx;
        });

        res.status(200).json({
            currentPage: page,
            totalPages: Math.min(Math.ceil(counted / limit), LIMITS.PAGE_MAX),
            totalItems: counted,
            transactions: enriched,
        });
    } catch (error) {
        fail(res, error);
    }
};

// ---------------------------------------------------------------------
// تحلیل‌گر هوش مصنوعی — فقط ۱۲ ماه اخیر
// ---------------------------------------------------------------------
exports.calculateUserStats = async (userId) => {
    const now = new Date();
    const range = { start: new Date(now.getFullYear(), now.getMonth() - 11, 1), end: now };
    return cached(userId, 'ai', {}, () => computeFinanceSummary(userId, range));
};

// ---------------------------------------------------------------------
// خلاصه مالی
// ---------------------------------------------------------------------
exports.getFinanceStats = heavy(async (req, res) => {
    try {
        const range = normalizeRange(req.query.from, req.query.to);
        if (!range) {
            return res.status(400).json({ message: `بازه تاریخ نامعتبر است (حداکثر ${LIMITS.RANGE_MAX_DAYS} روز)` });
        }
        const card = await parseCard(asStr(req.query.cardId), req.user.id);
        if (card.error) return res.status(400).json(INVALID_CARD_MSG);

        const summary = await cached(
            req.user.id, 'finance',
            { f: range.start.getTime(), t: range.end.getTime(), c: String(card.id || '') },
            () => computeFinanceSummary(req.user.id, range, card.id)
        );
        res.status(200).json({ summary });
    } catch (error) {
        fail(res, error);
    }
});

// ---------------------------------------------------------------------
// نمودار دایره‌ای دسته‌بندی
// ---------------------------------------------------------------------
exports.getCategoryStats = heavy(async (req, res) => {
    try {
        const range = normalizeRange(req.query.from, req.query.to);
        if (!range) {
            return res.status(400).json({ message: `بازه تاریخ نامعتبر است (حداکثر ${LIMITS.RANGE_MAX_DAYS} روز)` });
        }
        const card = await parseCard(asStr(req.query.cardId), req.user.id);
        if (card.error) return res.status(400).json(INVALID_CARD_MSG);

        const typeQ = asStr(req.query.type);
        const type = typeQ && VALID_TYPES.includes(typeQ) ? typeQ : undefined;

        const payload = await cached(
            req.user.id, 'category',
            { f: range.start.getTime(), t: range.end.getTime(), c: String(card.id || ''), type },
            async () => {
                const baseMatch = { userId: oid(req.user.id), ...dateMatch(range) };
                if (card.id) baseMatch.cardId = card.id;

                if (type === 'INCOME') {
                    const agg = await Transaction.aggregate([
                        { $match: { ...baseMatch, type: 'INCOME' } },
                        { $group: { _id: null, totalAmount: { $sum: '$amount' }, count: { $sum: 1 } } },
                    ]).option({ maxTimeMS: LIMITS.QUERY_MAX_MS });
                    const income = agg[0] || { totalAmount: 0, count: 0 };
                    return {
                        total: income.totalAmount,
                        categories: income.totalAmount > 0 ? [{
                            id: 'INCOME', label: 'درآمد', icon: '💰',
                            totalAmount: income.totalAmount, count: income.count, percentage: 100,
                        }] : [],
                    };
                }

                const match = { ...baseMatch, category: { $ne: null } };
                if (type) match.type = type;

                const [stats, categoryMap] = await Promise.all([
                    Transaction.aggregate([
                        { $match: match },
                        { $group: { _id: '$category', totalAmount: { $sum: '$amount' }, count: { $sum: 1 } } },
                        { $sort: { totalAmount: -1 } },
                    ]).option({ maxTimeMS: LIMITS.QUERY_MAX_MS }),
                    getUserCategoryMap(req.user.id),
                ]);

                const total = stats.reduce((s, i) => s + i.totalAmount, 0);
                const categories = stats.slice(0, LIMITS.CATEGORY_SLICES_MAX).map(item => {
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
                return { total, categories };
            }
        );

        res.status(200).json(payload);
    } catch (error) {
        fail(res, error);
    }
});

// ---------------------------------------------------------------------
// دسته‌بندی‌ها
// ---------------------------------------------------------------------
exports.getCategories = async (req, res) => {
    try {
        const customCats = await Category.find({ userId: req.user.id })
            .select('id label icon')
            .limit(LIMITS.CUSTOM_CATEGORIES_MAX + 20)
            .lean()
            .maxTimeMS(LIMITS.QUERY_MAX_MS);
        const presets = CATEGORIES.map(c => ({ ...c, isCustom: false }));
        const custom = customCats.map(c => ({ id: c.id, label: c.label, icon: c.icon, isCustom: true }));
        res.status(200).json({ categories: [...presets, ...custom] });
    } catch (error) {
        fail(res, error);
    }
};

exports.addCustomCategory = async (req, res) => {
    try {
        const { label, icon } = req.body;
        const trimmedLabel = String(label ?? '').trim();
        const trimmedIcon = String(icon ?? '').trim();

        if (!trimmedLabel) {
            return res.status(400).json({ message: 'نام دسته‌بندی الزامی است' });
        }
        if (trimmedLabel.length > 30) {
            return res.status(400).json({ message: 'نام دسته‌بندی خیلی طولانی است' });
        }
        if (trimmedIcon.length > 8) {
            return res.status(400).json({ message: 'آیکون نامعتبر است' });
        }

        // یک خواندن به‌جای count + regex
        const existing = await Category.find({ userId: req.user.id })
            .select('label')
            .limit(LIMITS.CUSTOM_CATEGORIES_MAX)
            .lean()
            .maxTimeMS(LIMITS.QUERY_MAX_MS);

        if (existing.length >= LIMITS.CUSTOM_CATEGORIES_MAX) {
            return res.status(400).json({ message: `حداکثر ${LIMITS.CUSTOM_CATEGORIES_MAX} دسته‌بندی شخصی مجاز است` });
        }
        const lower = trimmedLabel.toLowerCase();
        if (existing.some(c => String(c.label).toLowerCase() === lower)) {
            return res.status(400).json({ message: 'این دسته‌بندی از قبل وجود دارد' });
        }

        const newCategory = await Category.create({
            userId: req.user.id,
            id: new mongoose.Types.ObjectId().toHexString(),
            label: trimmedLabel,
            icon: trimmedIcon,
        });

        invalidateCategories(req.user.id);
        res.status(201).json({
            message: 'دسته‌بندی با موفقیت ساخته شد',
            category: { id: newCategory.id, label: newCategory.label, icon: newCategory.icon, isCustom: true },
        });
    } catch (error) {
        fail(res, error);
    }
};

exports.deleteCustomCategory = async (req, res) => {
    try {
        const id = asStr(req.params.id);
        if (!id) return res.status(404).json({ message: 'دسته‌بندی مورد نظر یافت نشد' });

        const deleted = await Category.findOneAndDelete({ id, userId: req.user.id });
        if (!deleted) {
            return res.status(404).json({ message: 'دسته‌بندی مورد نظر یافت نشد' });
        }

        invalidateCategories(req.user.id);
        invalidateUser(req.user.id);
        res.status(200).json({ message: 'دسته‌بندی با موفقیت حذف شد' });
    } catch (error) {
        fail(res, error);
    }
};

// ---------------------------------------------------------------------
// پرداخت قسط
// ---------------------------------------------------------------------
exports.payInstallment = async (req, res) => {
    try {
        const installmentId = req.params.id;
        if (!isValidId(installmentId)) {
            return res.status(404).json({ message: 'قسط مورد نظر یافت نشد' });
        }
        const { cardId } = req.body;

        const updateFields = { isPaid: true, date: Date.now() };

        if (cardId !== undefined) {
            const card = await parseCard(cardId, req.user.id); // null مجاز است
            if (card.error) return res.status(400).json(INVALID_CARD_MSG);
            updateFields.cardId = card.id;
        }

        // شرط isPaid:false داخل همین کوئری = اتمیک
        const updated = await Transaction.findOneAndUpdate(
            { _id: installmentId, userId: req.user.id, type: 'INSTALLMENT', isPaid: false },
            updateFields,
            { new: true }
        );

        if (!updated) {
            const exists = await Transaction.exists({ _id: installmentId, userId: req.user.id, type: 'INSTALLMENT' });
            if (!exists) return res.status(404).json({ message: 'قسط مورد نظر یافت نشد' });
            return res.status(400).json({ message: 'این قسط قبلاً پرداخت شده است' });
        }

        invalidateUser(req.user.id);
        res.status(200).json({ message: 'قسط با موفقیت پرداخت شد', installment: updated });
    } catch (error) {
        fail(res, error);
    }
};

// ---------------------------------------------------------------------
// ویرایش تراکنش
// ---------------------------------------------------------------------
exports.updateTransaction = async (req, res) => {
    try {
        const { id } = req.params;
        if (!isValidId(id)) {
            return res.status(404).json({ message: 'تراکنش مورد نظر یافت نشد' });
        }
        const { amount, title, description, dueDate, category, date, cardId } = req.body;

        if (amount !== undefined && !isMoney(amount)) {
            return res.status(400).json({ message: 'مبلغ باید بیشتر از صفر باشد' });
        }
        if (tooLong(title, LIMITS.TITLE_MAX) || tooLong(description, LIMITS.DESC_MAX)) {
            return res.status(400).json({ message: 'متن خیلی طولانی است' });
        }

        // فقط وقتی مبلغ/کارت تغییر می‌کند لازم است نوع انتقالی بودن چک شود
        if (amount !== undefined || cardId !== undefined) {
            const existing = await Transaction.findOne({ _id: id, userId: req.user.id })
                .select('transferId').lean();
            if (!existing) {
                return res.status(404).json({ message: 'تراکنش مورد نظر یافت نشد' });
            }
            if (existing.transferId) {
                return res.status(400).json({
                    message: 'مبلغ و کارت انتقال قابل ویرایش نیست؛ انتقال را حذف و دوباره ثبت کن',
                });
            }
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
            const p = parseTxDate(date);
            if (p.error) return res.status(400).json({ message: p.error });
            updateFields.date = p.value;
        }

        if (cardId !== undefined) {
            const card = await parseCard(cardId, req.user.id);
            if (card.error) return res.status(400).json(INVALID_CARD_MSG);
            updateFields.cardId = card.id;
        }

        const updatedTx = await Transaction.findOneAndUpdate(
            { _id: id, userId: req.user.id },
            updateFields,
            { new: true, runValidators: true }
        );
        if (!updatedTx) {
            return res.status(404).json({ message: 'تراکنش مورد نظر یافت نشد' });
        }

        invalidateUser(req.user.id);
        res.status(200).json({ message: 'تراکنش با موفقیت ویرایش شد', transaction: updatedTx });
    } catch (error) {
        fail(res, error);
    }
};

// ---------------------------------------------------------------------
// حذف تراکنش
// ---------------------------------------------------------------------
exports.deleteTransaction = async (req, res) => {
    try {
        const { id } = req.params;
        if (!isValidId(id)) {
            return res.status(404).json({ message: 'تراکنش مورد نظر یافت نشد' });
        }

        const transaction = await Transaction.findOne({ _id: id, userId: req.user.id })
            .select('transferId type').lean();
        if (!transaction) {
            return res.status(404).json({ message: 'تراکنش مورد نظر یافت نشد' });
        }

        if (transaction.transferId) {
            await Transaction.deleteMany({ transferId: transaction.transferId, userId: req.user.id });
        } else if (transaction.type === 'LOAN') {
            await Transaction.deleteMany({ loanId: transaction._id, userId: req.user.id });
            await Transaction.deleteOne({ _id: id, userId: req.user.id });
        } else {
            await Transaction.deleteOne({ _id: id, userId: req.user.id });
        }

        invalidateUser(req.user.id);
        res.status(200).json({ message: 'تراکنش با موفقیت حذف شد' });
    } catch (error) {
        fail(res, error);
    }
};

// ---------------------------------------------------------------------
// مقایسه ماه جاری با ماه قبل — یک aggregate
// ---------------------------------------------------------------------
exports.getMonthlyComparison = heavy(async (req, res) => {
    try {
        const payload = await cached(req.user.id, 'comparison', {}, async () => {
            const now = new Date();
            const prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            const currEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

            const map = await monthlyTotals(req.user.id, prevStart, currEnd, null);
            const keyOf = (d) => `${d.getFullYear()}-${d.getMonth() + 1}`;
            const cur = map[keyOf(now)] || emptyMonth();
            const prev = map[keyOf(prevStart)] || emptyMonth();

            const curr = { income: cur.INCOME, expense: cur.EXPENSE, cashBalance: monthBalance(cur) };
            const previous = { income: prev.INCOME, expense: prev.EXPENSE, cashBalance: monthBalance(prev) };

            const calcChange = (c, p) => {
                if (p === 0) return c > 0 ? 100 : 0;
                return Math.round(((c - p) / p) * 100);
            };

            return {
                current: curr,
                previous,
                changes: {
                    income: calcChange(curr.income, previous.income),
                    expense: calcChange(curr.expense, previous.expense),
                    cashBalance: calcChange(curr.cashBalance, previous.cashBalance),
                },
            };
        });
        res.status(200).json(payload);
    } catch (error) {
        fail(res, error);
    }
});

// ---------------------------------------------------------------------
// خروجی CSV — محدود، تکه‌تکه، با آزاد کردن event loop
// ---------------------------------------------------------------------
const TYPE_LABELS = {
    INCOME: 'درآمد',
    EXPENSE: 'خرج',
    INSTALLMENT: 'قسط',
    LOAN: 'وام',
    GOAL_DEPOSIT: 'واریز به هدف',
    TRANSFER_IN: 'انتقال ورودی',
    TRANSFER_OUT: 'انتقال خروجی',
};

const faDateFormatter = new Intl.DateTimeFormat('fa-IR');

// جلوگیری از اجرای فرمول در اکسل + escape کوتیشن
const csvCell = (val) => {
    let s = String(val ?? '');
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
};

const tick = () => new Promise(resolve => setImmediate(resolve));

exports.exportTransactionsCSV = heavy(async (req, res) => {
    try {
        const range = normalizeRange(req.query.from, req.query.to);
        if (!range) {
            return res.status(400).json({ message: `بازه تاریخ نامعتبر است (حداکثر ${LIMITS.RANGE_MAX_DAYS} روز)` });
        }

        const filter = { userId: req.user.id, ...dateMatch(range) };

        const cardQ = asStr(req.query.cardId);
        if (cardQ === 'none') {
            filter.cardId = null;
        } else if (cardQ) {
            if (!isValidId(cardQ)) return res.status(400).json(INVALID_CARD_MSG);
            filter.cardId = oid(cardQ);
        }

        const search = asStr(req.query.search)?.trim();
        if (search && search.length >= LIMITS.SEARCH_MIN) {
            const rx = escapeRegex(search.slice(0, LIMITS.SEARCH_MAX));
            filter.$or = [
                { title: { $regex: rx, $options: 'i' } },
                { description: { $regex: rx, $options: 'i' } },
            ];
        }

        const [transactions, categoryMap, cards] = await Promise.all([
            Transaction.find(filter)
                .select('title type category cardId amount description date isPaid')
                .sort({ date: -1 })
                .limit(LIMITS.CSV_MAX_ROWS)
                .lean()
                .maxTimeMS(LIMITS.QUERY_MAX_MS),
            getUserCategoryMap(req.user.id),
            Card.find({ userId: req.user.id }).select('name').limit(50).lean(),
        ]);

        const cardMap = new Map(cards.map(c => [c._id.toString(), c.name]));

        const categoryLabel = (catId) => {
            const info = lookupCategoryInfo(catId, categoryMap);
            return info ? `${info.icon} ${info.label}` : '-';
        };

        const header = ['ردیف', 'عنوان', 'نوع', 'دسته‌بندی', 'کارت', 'مبلغ (ریال)', 'توضیحات', 'تاریخ', 'وضعیت پرداخت'].join(',');

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="sablo-transactions-${Date.now()}.csv"`);
        if (transactions.length >= LIMITS.CSV_MAX_ROWS) res.setHeader('X-Export-Truncated', 'true');
        res.status(200);
        res.write('\uFEFF' + header + '\n');

        for (let i = 0; i < transactions.length; i += LIMITS.CSV_CHUNK) {
            if (res.destroyed) return; // کاربر قطع کرده
            const part = transactions.slice(i, i + LIMITS.CSV_CHUNK).map((tx, j) => {
                const isPaid = tx.type === 'INSTALLMENT'
                    ? (tx.isPaid ? 'پرداخت شده' : 'پرداخت نشده')
                    : '-';
                const cardName = tx.cardId ? (cardMap.get(tx.cardId.toString()) || '-') : '-';
                return [
                    i + j + 1,
                    csvCell(tx.title),
                    csvCell(TYPE_LABELS[tx.type] || tx.type),
                    csvCell(categoryLabel(tx.category)),
                    csvCell(cardName),
                    Number(tx.amount) || 0,
                    csvCell(tx.description),
                    csvCell(faDateFormatter.format(new Date(tx.date))),
                    csvCell(isPaid),
                ].join(',');
            }).join('\n');
            res.write(part + '\n');
            await tick();
        }
        res.end();
    } catch (error) {
        if (res.headersSent) return res.end();
        fail(res, error);
    }
});

// ---------------------------------------------------------------------
// نمای کلی چند ماه اخیر
// ---------------------------------------------------------------------
exports.getMonthlyOverview = heavy(async (req, res) => {
    try {
        const monthsCount = clamp(parseInt(req.query.months) || 6, 1, LIMITS.MONTHS_MAX);
        const card = await parseCard(asStr(req.query.cardId), req.user.id);
        if (card.error) return res.status(400).json(INVALID_CARD_MSG);

        const payload = await cached(
            req.user.id, 'overview',
            { m: monthsCount, c: String(card.id || '') },
            async () => {
                const now = new Date();
                const start = new Date(now.getFullYear(), now.getMonth() - (monthsCount - 1), 1);
                const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
                const map = await monthlyTotals(req.user.id, start, end, card.id);

                const result = [];
                for (let i = monthsCount - 1; i >= 0; i--) {
                    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
                    const data = map[`${d.getFullYear()}-${d.getMonth() + 1}`] || emptyMonth();
                    result.push({
                        year: d.getFullYear(),
                        month: d.getMonth() + 1,
                        from: new Date(d.getFullYear(), d.getMonth(), 1),
                        to: new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59),
                        income: data.INCOME,
                        expense: data.EXPENSE,
                        transferIn: data.TRANSFER_IN,
                        transferOut: data.TRANSFER_OUT,
                        balance: monthBalance(data),
                    });
                }
                return { months: result };
            }
        );
        res.status(200).json(payload);
    } catch (error) {
        fail(res, error);
    }
});

// ---------------------------------------------------------------------
// ساخت وام + اقساط (تاریخ‌ها از فرانت می‌آیند)
// ---------------------------------------------------------------------
exports.createLoanWithInstallments = async (req, res) => {
    try {
        const {
            title, totalAmount, installmentCount, installmentAmount,
            installmentDates, description, cardId,
        } = req.body;

        const count = Number(installmentCount);
        const cleanTitle = String(title ?? '').trim();

        if (!cleanTitle) {
            return res.status(400).json({ message: 'نام وام الزامی است' });
        }
        if (cleanTitle.length > LIMITS.TITLE_MAX || tooLong(description, LIMITS.DESC_MAX)) {
            return res.status(400).json({ message: 'متن خیلی طولانی است' });
        }
        if (!isMoney(totalAmount)) {
            return res.status(400).json({ message: 'مبلغ کل وام باید بیشتر از صفر باشد' });
        }
        if (!Number.isInteger(count) || count < 1 || count > LIMITS.INSTALLMENTS_MAX) {
            return res.status(400).json({ message: `تعداد اقساط باید بین ۱ تا ${LIMITS.INSTALLMENTS_MAX} باشد` });
        }
        if (!isMoney(installmentAmount)) {
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

        const [card, loansCount] = await Promise.all([
            parseCard(cardId, req.user.id),
            Transaction.countDocuments({ userId: req.user.id, type: 'LOAN' }).limit(LIMITS.LOANS_MAX_PER_USER),
        ]);
        if (card.error) return res.status(400).json(INVALID_CARD_MSG);
        if (loansCount >= LIMITS.LOANS_MAX_PER_USER) {
            return res.status(400).json({ message: `حداکثر ${LIMITS.LOANS_MAX_PER_USER} وام مجاز است` });
        }

        const firstDueDate = dueDates[0];
        const lastDueDate = dueDates[dueDates.length - 1];
        const now = new Date();

        const loanTx = await Transaction.create({
            userId: req.user.id,
            type: 'LOAN',
            amount: totalAmount,
            title: cleanTitle,
            description: String(description ?? '').trim(),
            date: now,
            dueDate: lastDueDate,
            isPaid: true,
            loanId: null,
            category: null,
            cardId: card.id,
        });

        const installments = dueDates.map((dueDate, i) => ({
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
            cardId: card.id,
        }));

        try {
            await Transaction.insertMany(installments, { ordered: true });
        } catch (insertError) {
            await Transaction.deleteMany({ $or: [{ _id: loanTx._id }, { loanId: loanTx._id }], userId: req.user.id });
            throw insertError;
        }

        invalidateUser(req.user.id);
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
                cardId: card.id,
            },
        });
    } catch (error) {
        fail(res, error);
    }
};

// ---------------------------------------------------------------------
// لیست وام‌ها — صفحه‌بندی؛ ریز اقساط فقط با ?details=1
// ---------------------------------------------------------------------
exports.getLoans = async (req, res) => {
    try {
        const userId = req.user.id;
        const page = clamp(parseInt(req.query.page) || 1, 1, LIMITS.LOANS_PAGE_MAX);
        const limit = clamp(parseInt(req.query.limit) || LIMITS.LOANS_PAGE_SIZE, 1, LIMITS.LOANS_PAGE_SIZE);
        const withDetails = req.query.details === '1';

        const loans = await Transaction.find({ userId, type: 'LOAN' })
            .select('title description date cardId amount')
            .sort({ date: -1 })
            .skip((page - 1) * limit)
            .limit(limit)
            .lean()
            .maxTimeMS(LIMITS.QUERY_MAX_MS);

        if (loans.length === 0) {
            return res.status(200).json({ loans: [], page });
        }

        const loanIds = loans.map(l => l._id);

        const [allInstallments, cards] = await Promise.all([
            Transaction.find({ userId, type: 'INSTALLMENT', loanId: { $in: loanIds } })
                .select('title amount dueDate isPaid date loanId')
                .sort({ dueDate: 1 })
                .limit(loanIds.length * LIMITS.INSTALLMENTS_MAX)
                .lean()
                .maxTimeMS(LIMITS.QUERY_MAX_MS),
            Card.find({ userId }).select('name icon color').limit(50).lean(),
        ]);

        const cardMap = new Map(cards.map(c => [c._id.toString(), { name: c.name, icon: c.icon, color: c.color }]));

        // یک گذر روی اقساط
        const agg = new Map();
        for (const inst of allInstallments) {
            const key = inst.loanId.toString();
            let a = agg.get(key);
            if (!a) {
                a = { total: 0, paid: 0, totalAmount: 0, paidAmount: 0, next: null, list: [] };
                agg.set(key, a);
            }
            a.total++;
            a.totalAmount += inst.amount;
            if (inst.isPaid) {
                a.paid++;
                a.paidAmount += inst.amount;
            } else if (!a.next) {
                a.next = inst; // به ترتیب dueDate مرتب است
            }
            if (withDetails) a.list.push(inst);
        }

        const result = loans.map(loan => {
            const a = agg.get(loan._id.toString()) || { total: 0, paid: 0, totalAmount: 0, paidAmount: 0, next: null, list: [] };
            const out = {
                _id: loan._id,
                title: loan.title,
                description: loan.description,
                date: loan.date,
                cardId: loan.cardId,
                cardInfo: loan.cardId ? (cardMap.get(loan.cardId.toString()) || null) : null,
                totalLoanAmount: loan.amount,
                totalAmount: a.totalAmount,
                paidAmount: a.paidAmount,
                remainingAmount: a.totalAmount - a.paidAmount,
                installmentCount: a.total,
                paidCount: a.paid,
                unpaidCount: a.total - a.paid,
                progressPercent: a.total > 0 ? Math.round((a.paid / a.total) * 100) : 0,
                isFullyPaid: a.total > 0 && a.paid === a.total,
                nextInstallment: a.next ? {
                    _id: a.next._id,
                    amount: a.next.amount,
                    dueDate: a.next.dueDate,
                    title: a.next.title,
                } : null,
            };
            if (withDetails) {
                out.installments = a.list.map(inst => ({
                    _id: inst._id,
                    title: inst.title,
                    amount: inst.amount,
                    dueDate: inst.dueDate,
                    isPaid: inst.isPaid,
                    date: inst.date,
                }));
            }
            return out;
        });

        res.status(200).json({ loans: result, page });
    } catch (error) {
        fail(res, error);
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
            .limit(LIMITS.UNPAID_MAX)
            .lean()
            .maxTimeMS(LIMITS.QUERY_MAX_MS);

        res.status(200).json({ installments });
    } catch (error) {
        fail(res, error);
    }
};

// ---------------------------------------------------------------------
// دنگ
// ---------------------------------------------------------------------
exports.calculateDong = async (req, res) => {
    try {
        const { participants } = req.body;

        if (
            !Array.isArray(participants) ||
            participants.length < 2 ||
            participants.length > LIMITS.DONG_PARTICIPANTS_MAX
        ) {
            return res.status(400).json({ message: `تعداد افراد باید بین ۲ تا ${LIMITS.DONG_PARTICIPANTS_MAX} باشد` });
        }

        for (const p of participants) {
            const name = String(p?.name ?? '').trim();
            if (!name || name.length > 30) {
                return res.status(400).json({ message: 'نام همه افراد الزامی است (حداکثر ۳۰ حرف)' });
            }
            if (!Number.isInteger(p.paid) || p.paid < 0 || p.paid > LIMITS.DONG_PAID_MAX) {
                return res.status(400).json({ message: 'مبلغ پرداختی باید عدد صحیح و غیرمنفی باشد' });
            }
            if (p.weight !== undefined &&
                (!Number.isInteger(p.weight) || p.weight < 1 || p.weight > LIMITS.DONG_WEIGHT_MAX)) {
                return res.status(400).json({ message: 'وزن سهم نامعتبر است' });
            }
        }

        const result = computeDong(participants);
        if (result.total === 0) {
            return res.status(400).json({ message: 'جمع هزینه‌ها صفر است' });
        }

        res.status(200).json({ ...result, settlementsCount: result.settlements.length });
    } catch (error) {
        fail(res, error);
    }
};

exports.saveDongAsExpense = async (req, res) => {
    try {
        const { title, myShare, category, cardId } = req.body;

        if (!Number.isInteger(myShare) || myShare <= 0 || myShare > LIMITS.AMOUNT_MAX) {
            return res.status(400).json({ message: 'مبلغ سهم نامعتبر است' });
        }
        if (tooLong(title, LIMITS.TITLE_MAX)) {
            return res.status(400).json({ message: 'متن خیلی طولانی است' });
        }

        const [categoryMap, card] = await Promise.all([
            getUserCategoryMap(req.user.id),
            parseCard(cardId, req.user.id),
        ]);
        if (card.error) return res.status(400).json(INVALID_CARD_MSG);

        const tx = await Transaction.create({
            userId: req.user.id,
            type: 'EXPENSE',
            amount: myShare,
            title: String(title ?? '').trim() || 'دنگ',
            description: 'ثبت‌شده از ماشین‌حساب دنگی',
            date: new Date(),
            category: resolveCategoryId(category, categoryMap),
            cardId: card.id,
            isPaid: true,
        });

        invalidateUser(req.user.id);
        res.status(201).json({ message: 'سهم شما به‌عنوان خرج ثبت شد', transaction: tx });
    } catch (error) {
        fail(res, error);
    }
};

// ---------------------------------------------------------------------
// انتقال بین دو کارت
// ---------------------------------------------------------------------
exports.createTransfer = async (req, res) => {
    try {
        const { fromCardId, toCardId, amount, description, date } = req.body;
        const userId = req.user.id;

        if (!Number.isInteger(amount) || amount <= 0 || amount > LIMITS.AMOUNT_MAX) {
            return res.status(400).json({ message: 'مبلغ انتقال باید عدد صحیح و بیشتر از صفر باشد' });
        }
        if (!fromCardId || !toCardId) {
            return res.status(400).json({ message: 'کارت مبدا و مقصد الزامی است' });
        }
        if (!isValidId(String(fromCardId)) || !isValidId(String(toCardId))) {
            return res.status(400).json(INVALID_CARD_MSG);
        }
        if (String(fromCardId) === String(toCardId)) {
            return res.status(400).json({ message: 'کارت مبدا و مقصد نمی‌تواند یکی باشد' });
        }
        if (tooLong(description, LIMITS.DESC_MAX)) {
            return res.status(400).json({ message: 'متن خیلی طولانی است' });
        }

        let txDate = new Date();
        if (date) {
            const p = parseTxDate(date);
            if (p.error) return res.status(400).json({ message: p.error });
            txDate = p.value;
        }

        const cards = await Card.find({ _id: { $in: [fromCardId, toCardId] }, userId })
            .select('name').lean();
        const fromCard = cards.find(c => String(c._id) === String(fromCardId));
        const toCard = cards.find(c => String(c._id) === String(toCardId));
        if (!fromCard || !toCard) {
            return res.status(400).json(INVALID_CARD_MSG);
        }

        const transferId = new mongoose.Types.ObjectId();
        const cleanDesc = String(description ?? '').trim();

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

            invalidateUser(userId);
            res.status(201).json({
                message: 'انتقال با موفقیت ثبت شد',
                transfer: { transferId, amount, from: fromCard.name, to: toCard.name },
                transactions: [outTx, inTx],
            });
        } catch (insertError) {
            await Transaction.deleteMany({ transferId, userId });
            throw insertError;
        }
    } catch (error) {
        fail(res, error);
    }
};

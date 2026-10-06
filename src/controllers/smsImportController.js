// controllers/smsImportController.js
const mongoose = require('mongoose');
const SmsImport = require('../models/SmsImport');
const Transaction = require('../models/Transaction');
const Category = require('../models/Category');
const Card = require('../models/Card');
const CATEGORIES = require('../constants/categories');

const MAX_BATCH = 20;                      // حداکثر پیامک در هر درخواست (با سقف 10kb بدنه در server.js هم‌خوان است)
const MAX_PENDING_PER_USER = 500;          // سقف صف تأییدنشده
const MAX_AMOUNT = 10_000_000_000_000;     // سقف منطقی مبلغ (ریال)
const MAX_AGE_DAYS = 30;                   // پیامک قدیمی‌تر از این پذیرفته نمی‌شود (باید < RETENTION_DAYS مدل باشد)
const DUP_WINDOW_MS = 6 * 60 * 60 * 1000;  // پنجره‌ی تشخیص شباهت با تراکنش دستی
const STALE_CLAIM_MS = 2 * 60 * 1000;      // CONFIRMING قدیمی‌تر از این (مثلاً کرش سرور) دوباره قابل claim است
const HASH_RE = /^[a-f0-9]{64}$/;

if (MAX_AGE_DAYS >= SmsImport.RETENTION_DAYS) {
    throw new Error('MAX_AGE_DAYS must be smaller than SmsImport.RETENTION_DAYS');
}

// ---------------------------------------------------------------------
// helperها
// ---------------------------------------------------------------------
const cleanStr = (v, max) =>
    String(v ?? '')
        .replace(/[\u0000-\u001F\u007F]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, max);

const isObjectId = (v) => mongoose.Types.ObjectId.isValid(v) && String(new mongoose.Types.ObjectId(v)) === String(v);

const serverError = (res, where, error) => {
    console.error(`[sms:${where}]`, error);
    return res.status(500).json({ message: 'خطای سرور' });
};

const buildTitle = (direction, bank, counterparty) => {
    const base = direction === 'DEPOSIT' ? 'واریز' : 'برداشت';
    if (counterparty) return `${base} — ${counterparty}`.slice(0, 100);
    if (bank) return `${base} ${bank}`.slice(0, 100);
    return base;
};

// اعتبارسنجی یک آیتم؛ یا {error} یا {value}
const validateItem = (raw) => {
    if (!raw || typeof raw !== 'object') return { error: 'INVALID_ITEM' };

    const smsHash = String(raw.smsHash ?? '').toLowerCase();
    if (!HASH_RE.test(smsHash)) return { error: 'INVALID_HASH' };

    if (raw.direction !== 'DEPOSIT' && raw.direction !== 'WITHDRAW') return { error: 'INVALID_DIRECTION' };

    if (raw.currency !== undefined && raw.currency !== 'IRR') return { error: 'INVALID_CURRENCY' };

    const amount = raw.amount;
    if (!Number.isSafeInteger(amount) || amount <= 0 || amount > MAX_AMOUNT) return { error: 'INVALID_AMOUNT' };

    let balanceAfter = null;
    if (raw.balanceAfter !== undefined && raw.balanceAfter !== null) {
        if (!Number.isSafeInteger(raw.balanceAfter) || raw.balanceAfter < 0 || raw.balanceAfter > MAX_AMOUNT) {
            return { error: 'INVALID_BALANCE' };
        }
        balanceAfter = raw.balanceAfter;
    }

    if (typeof raw.date !== 'string') return { error: 'INVALID_DATE' };
    const date = new Date(raw.date);
    if (isNaN(date.getTime())) return { error: 'INVALID_DATE' };
    const now = Date.now();
    if (date.getTime() > now + 24 * 60 * 60 * 1000) return { error: 'DATE_IN_FUTURE' };
    if (date.getTime() < now - MAX_AGE_DAYS * 24 * 60 * 60 * 1000) return { error: 'DATE_TOO_OLD' };

    const bank = cleanStr(raw.bank, 40);
    const counterparty = cleanStr(raw.counterparty, 60);
    const parserVersion = Number.isInteger(raw.parserVersion) && raw.parserVersion > 0 ? raw.parserVersion : 1;

    return {
        value: {
            smsHash,
            direction: raw.direction,
            type: raw.direction === 'DEPOSIT' ? 'INCOME' : 'EXPENSE',
            amount,
            balanceAfter,
            date,
            bank,
            counterparty,
            suggestedTitle: buildTitle(raw.direction, bank, counterparty),
            parserVersion,
        },
    };
};

// دسته‌ی نامعتبر => null (و کنترلر 400 می‌دهد)
const resolveCategory = async (category, userId) => {
    if (typeof category !== 'string') return null;
    if (CATEGORIES.some((c) => c.id === category)) return category;
    const custom = await Category.exists({ id: category, userId });
    return custom ? category : null;
};

const resolveCardId = async (cardId, userId) => {
    if (!isObjectId(cardId)) throw new Error('INVALID_CARD');
    const card = await Card.findOne({ _id: cardId, userId }).select('_id').lean();
    if (!card) throw new Error('INVALID_CARD');
    return card._id;
};

// ---------------------------------------------------------------------
// ۱) دریافت دسته‌ای پیامک‌های پارس‌شده از فرانت (فقط در صف می‌گذارد)
// POST /finance/sms/import   body: { items: [...] }
// ---------------------------------------------------------------------
exports.importSms = async (req, res) => {
    try {
        const { items } = req.body;

        if (!Array.isArray(items) || items.length === 0 || items.length > MAX_BATCH) {
            return res.status(400).json({ message: `تعداد پیامک‌ها باید بین ۱ تا ${MAX_BATCH} باشد` });
        }

        const userId = req.user.id;

        const pendingCount = await SmsImport.countDocuments({ userId, status: 'PENDING' });
        if (pendingCount + items.length > MAX_PENDING_PER_USER) {
            return res.status(400).json({ message: 'تعداد تراکنش‌های در انتظار تأیید زیاد است. ابتدا آن‌ها را تأیید یا رد کنید' });
        }

        // ۱. اعتبارسنجی
        const results = new Array(items.length);
        const valid = []; // { index, value }
        const seenInBatch = new Set();

        items.forEach((raw, index) => {
            const { error, value } = validateItem(raw);
            if (error) {
                results[index] = { index, status: 'invalid', reason: error };
            } else if (seenInBatch.has(value.smsHash)) {
                results[index] = { index, status: 'duplicate', reason: 'DUPLICATE_IN_BATCH' };
            } else {
                seenInBatch.add(value.smsHash);
                valid.push({ index, value });
            }
        });

        // ۲. حذف مواردی که قبلاً دریافت شده‌اند (در هر وضعیتی، حتی رد شده)
        const existing = valid.length
            ? await SmsImport.find({ userId, smsHash: { $in: valid.map((v) => v.value.smsHash) } })
                  .select('smsHash status')
                  .lean()
            : [];
        const existingMap = new Map(existing.map((e) => [e.smsHash, e.status]));

        // ۳. ساخت رکوردهای جدید
        for (const { index, value } of valid) {
            if (existingMap.has(value.smsHash)) {
                results[index] = { index, status: 'duplicate', reason: 'ALREADY_IMPORTED', existingStatus: existingMap.get(value.smsHash) };
                continue;
            }

            // هشدار شباهت با تراکنش دستی (نه حذف خودکار)
            const similar = await Transaction.findOne({
                userId,
                type: value.type,
                amount: value.amount,
                date: {
                    $gte: new Date(value.date.getTime() - DUP_WINDOW_MS),
                    $lte: new Date(value.date.getTime() + DUP_WINDOW_MS),
                },
            }).select('_id').lean();

            try {
                const doc = await SmsImport.create({
                    userId,
                    ...value,
                    possibleDuplicateOf: similar ? similar._id : null,
                });
                results[index] = {
                    index,
                    status: 'created',
                    id: doc._id,
                    possibleDuplicate: Boolean(similar),
                };
            } catch (err) {
                if (err && err.code === 11000) {
                    // درخواست هم‌زمان همان پیامک را ثبت کرده
                    results[index] = { index, status: 'duplicate', reason: 'ALREADY_IMPORTED' };
                } else {
                    throw err;
                }
            }
        }

        const summary = {
            created: results.filter((r) => r.status === 'created').length,
            duplicate: results.filter((r) => r.status === 'duplicate').length,
            invalid: results.filter((r) => r.status === 'invalid').length,
        };

        res.status(200).json({ message: 'پیامک‌ها دریافت شد', summary, results });
    } catch (error) {
        serverError(res, 'import', error);
    }
};

// ---------------------------------------------------------------------
// ۲) لیست در انتظار تأیید
// GET /finance/sms/pending?page=1&limit=20
// ---------------------------------------------------------------------
exports.getPendingSms = async (req, res) => {
    try {
        const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50);
        const filter = { userId: req.user.id, status: 'PENDING' };

        const [items, total] = await Promise.all([
            SmsImport.find(filter)
                .sort({ date: -1 })
                .skip((page - 1) * limit)
                .limit(limit)
                .select('-smsHash -userId -__v')
                .lean(),
            SmsImport.countDocuments(filter),
        ]);

        res.status(200).json({
            currentPage: page,
            totalPages: Math.ceil(total / limit),
            totalItems: total,
            items,
        });
    } catch (error) {
        serverError(res, 'pending', error);
    }
};

// ---------------------------------------------------------------------
// ۳) تأیید و تبدیل به تراکنش واقعی
// POST /finance/sms/:id/confirm   body: { title?, category?, cardId?, type? }
//
// ضدتکراری: شناسه‌ی تراکنش پیش از ساخت روی SmsImport ذخیره می‌شود و تراکنش با همان
// _id ساخته می‌شود. پس هر تلاش مجدد (خطا یا کرش وسط کار) یا همان تراکنش را پیدا
// می‌کند یا دقیقاً با همان _id می‌سازد و هرگز دو تراکنش ایجاد نمی‌شود.
// ---------------------------------------------------------------------
exports.confirmSms = async (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;
    let claimed = false;
    let txId = null;

    try {
        if (!isObjectId(id)) return res.status(400).json({ message: 'شناسه نامعتبر است' });

        const { title, category, cardId, type } = req.body;

        if (type !== undefined && type !== 'INCOME' && type !== 'EXPENSE') {
            return res.status(400).json({ message: 'نوع تراکنش نامعتبر است' });
        }

        let resolvedCardId = null;
        if (cardId !== undefined && cardId !== null && cardId !== '') {
            try {
                resolvedCardId = await resolveCardId(cardId, userId);
            } catch {
                return res.status(400).json({ message: 'کارت انتخاب‌شده معتبر نیست' });
            }
        }

        let resolvedCategory = null;
        if (category !== undefined && category !== null && category !== '') {
            resolvedCategory = await resolveCategory(category, userId);
            if (!resolvedCategory) return res.status(400).json({ message: 'دسته‌بندی انتخاب‌شده معتبر نیست' });
        }

        // claim اتمیک: فقط یک درخواست می‌تواند بردارد (PENDING یا CONFIRMING کهنه‌ی مانده از کرش)
        const item = await SmsImport.findOneAndUpdate(
            {
                _id: id,
                userId,
                $or: [
                    { status: 'PENDING' },
                    { status: 'CONFIRMING', updatedAt: { $lt: new Date(Date.now() - STALE_CLAIM_MS) } },
                ],
            },
            { $set: { status: 'CONFIRMING' } },
            { new: true }
        );

        if (!item) {
            const exists = await SmsImport.exists({ _id: id, userId });
            return exists
                ? res.status(409).json({ message: 'این مورد قبلاً بررسی شده است' })
                : res.status(404).json({ message: 'مورد یافت نشد' });
        }
        claimed = true;

        // شناسه‌ی تراکنش را قبل از ساخت ثبت می‌کنیم (در تلاش مجدد همان قبلی استفاده می‌شود)
        txId = item.transactionId || new mongoose.Types.ObjectId();
        if (!item.transactionId) {
            await SmsImport.updateOne({ _id: item._id }, { $set: { transactionId: txId } });
        }

        let tx = await Transaction.findOne({ _id: txId, userId });
        if (!tx) {
            const cleanTitle = cleanStr(title, 100) || item.suggestedTitle || 'تراکنش بانکی';
            tx = await Transaction.create({
                _id: txId,
                userId,
                type: type || item.type,
                amount: item.amount,
                title: cleanTitle,
                description: 'ثبت‌شده از پیامک بانکی',
                date: item.date,
                category: resolvedCategory,
                cardId: resolvedCardId,
                isPaid: true,
            });
        }

        await SmsImport.updateOne(
            { _id: item._id },
            { $set: { status: 'CONFIRMED', transactionId: tx._id, confirmedAt: new Date() } }
        );
        claimed = false;

        res.status(201).json({ message: 'تراکنش با موفقیت ثبت شد', transaction: tx });
    } catch (error) {
        if (claimed) {
            try {
                // اگر تراکنش واقعاً ساخته شده، نباید به صف برگردد (وگرنه تکراری می‌شود)
                const txExists = txId ? await Transaction.exists({ _id: txId, userId }) : null;
                if (txExists) {
                    await SmsImport.updateOne(
                        { _id: id, userId, status: 'CONFIRMING' },
                        { $set: { status: 'CONFIRMED', transactionId: txId, confirmedAt: new Date() } }
                    );
                } else {
                    await SmsImport.updateOne(
                        { _id: id, userId, status: 'CONFIRMING' },
                        { $set: { status: 'PENDING', transactionId: null } }
                    );
                }
            } catch (rollbackErr) {
                // در بدترین حالت CONFIRMING می‌ماند و بعد از STALE_CLAIM_MS با همان txId دوباره قابل تلاش است
                console.error('[sms:confirm:rollback]', rollbackErr);
            }
        }
        serverError(res, 'confirm', error);
    }
};

// ---------------------------------------------------------------------
// ۴) رد کردن (hash نگه داشته می‌شود تا همان پیامک دوباره نیاید)
// POST /finance/sms/:id/reject
// ---------------------------------------------------------------------
exports.rejectSms = async (req, res) => {
    try {
        const { id } = req.params;
        if (!isObjectId(id)) return res.status(400).json({ message: 'شناسه نامعتبر است' });

        const item = await SmsImport.findOneAndUpdate(
            { _id: id, userId: req.user.id, status: 'PENDING' },
            { $set: { status: 'REJECTED', rejectedAt: new Date() } },
            { new: true }
        );

        if (!item) {
            const exists = await SmsImport.exists({ _id: id, userId: req.user.id });
            return exists
                ? res.status(409).json({ message: 'این مورد قبلاً بررسی شده است' })
                : res.status(404).json({ message: 'مورد یافت نشد' });
        }

        res.status(200).json({ message: 'مورد رد شد' });
    } catch (error) {
        serverError(res, 'reject', error);
    }
};

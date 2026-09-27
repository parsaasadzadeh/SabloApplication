const Goal = require('../models/Goal');
const Transaction = require('../models/Transaction');
const Card = require('../models/Card');
const mongoose = require('mongoose');

// ---------------------------------------------------------------------
// helper: مجموع واریزهای یک هدف + تفکیک بر اساس کارت
// ---------------------------------------------------------------------
const calculateGoalProgress = async (userId, goalId) => {
    const stats = await Transaction.aggregate([
        {
            $match: {
                userId: new mongoose.Types.ObjectId(userId),
                goalId: new mongoose.Types.ObjectId(goalId),
                type: 'GOAL_DEPOSIT'
            }
        },
        {
            $group: {
                _id: '$cardId',
                totalAmount: { $sum: '$amount' },
                count: { $sum: 1 }
            }
        }
    ]);

    const savedAmount = stats.reduce((sum, s) => sum + s.totalAmount, 0);
    return { savedAmount, breakdown: stats };
};

// پیش‌بینی زمان رسیدن به هدف بر اساس میانگین ماهانه واریزهای واقعی همون هدف
const predictMonths = (savedAmount, targetAmount, goalCreatedAt) => {
    const now = new Date();
    const monthsElapsed = Math.max(1,
        (now.getFullYear() - goalCreatedAt.getFullYear()) * 12 +
        (now.getMonth() - goalCreatedAt.getMonth())
    );
    const monthlyRate = savedAmount / monthsElapsed;
    if (monthlyRate <= 0) return null;
    const remaining = targetAmount - savedAmount;
    if (remaining <= 0) return 0;
    return Math.ceil(remaining / monthlyRate);
};

// ── دریافت همه اهداف ──────────────────────────────────────────────────────────
exports.getGoals = async (req, res) => {
    try {
        const goals = await Goal.find({ userId: req.user.id }).sort({ createdAt: -1 });
        const cards = await Card.find({ userId: req.user.id }).lean();
        const cardMap = new Map();
        cards.forEach(c => cardMap.set(c._id.toString(), { name: c.name, icon: c.icon, color: c.color }));

        const goalsWithProgress = await Promise.all(
            goals.map(async (goal) => {
                const { savedAmount, breakdown } = await calculateGoalProgress(req.user.id, goal._id);
                const percent = Math.min(100, Math.round((savedAmount / goal.targetAmount) * 100));
                const predictedMonths = predictMonths(savedAmount, goal.targetAmount, goal.createdAt);
                const remaining = Math.max(0, goal.targetAmount - savedAmount);

                const isExpired = new Date() > new Date(goal.deadline);
                const isCompleted = savedAmount >= goal.targetAmount;

                // تفکیک واریزها بر اساس کارت — کاربر می‌بینه چقدر از کدوم کارت گذاشته
                const depositsByCard = breakdown.map(b => ({
                    cardId: b._id,
                    cardInfo: b._id ? (cardMap.get(b._id.toString()) || null) : null,
                    amount: b.totalAmount,
                    count: b.count
                }));

                return {
                    ...goal.toObject(),
                    savedAmount,
                    remaining,
                    percent,
                    predictedMonths,
                    isExpired,
                    isCompleted,
                    depositsByCard,
                };
            })
        );

        res.status(200).json({ goals: goalsWithProgress });
    } catch (error) {
        res.status(500).json({ message: 'خطای سرور', error: error.message });
    }
};

// ── ساخت هدف جدید (بدون تغییر) ────────────────────────────────────────────────
exports.createGoal = async (req, res) => {
    try {
        const { title, targetAmount, deadline } = req.body;

        if (!title || !targetAmount || !deadline) {
            return res.status(400).json({ message: 'عنوان، مبلغ هدف و ددلاین الزامی هستند' });
        }
        if (targetAmount <= 0) {
            return res.status(400).json({ message: 'مبلغ هدف باید بیشتر از صفر باشد' });
        }
        if (new Date(deadline) <= new Date()) {
            return res.status(400).json({ message: 'تاریخ هدف باید در آینده باشد' });
        }

        const goal = await Goal.create({
            userId: req.user.id,
            title,
            targetAmount,
            deadline: new Date(deadline),
        });

        res.status(201).json({ message: 'هدف با موفقیت ثبت شد', goal });
    } catch (error) {
        res.status(500).json({ message: 'خطای سرور', error: error.message });
    }
};

// ── واریز به هدف — کارت دیگه اجباری نیست ────────────────────────────────────
exports.depositToGoal = async (req, res) => {
    try {
        const { id } = req.params; // goalId
        const { cardId, amount, date, description } = req.body;

        if (!amount || amount <= 0) {
            return res.status(400).json({ message: 'مبلغ واریز باید بیشتر از صفر باشد' });
        }

        const goal = await Goal.findOne({ _id: id, userId: req.user.id });
        if (!goal) {
            return res.status(404).json({ message: 'هدف مورد نظر یافت نشد' });
        }

        // اگه کارتی فرستاده شده، اعتبارش رو چک کن؛ اگه نه، بدون کارت ثبت میشه
        let resolvedCardId = null;
        if (cardId) {
            const card = await Card.findOne({ _id: cardId, userId: req.user.id });
            if (!card) {
                return res.status(400).json({ message: 'کارت انتخاب‌شده معتبر نیست' });
            }
            resolvedCardId = card._id;
        }

        let txDate = new Date();
        if (date) {
            const parsedDate = new Date(date);
            if (isNaN(parsedDate.getTime())) {
                return res.status(400).json({ message: 'تاریخ نامعتبر است' });
            }
            const oneDayMs = 24 * 60 * 60 * 1000;
            if (parsedDate.getTime() > Date.now() + oneDayMs) {
                return res.status(400).json({ message: 'تاریخ نمی‌تواند در آینده باشد' });
            }
            txDate = parsedDate;
        }

        const deposit = await Transaction.create({
            userId: req.user.id,
            type: 'GOAL_DEPOSIT',
            amount,
            title: `واریز به هدف «${goal.title}»`,
            description: description?.trim() || '',
            date: txDate,
            category: null,
            cardId: resolvedCardId,
            goalId: goal._id,
            isPaid: true,
        });

        const { savedAmount } = await calculateGoalProgress(req.user.id, goal._id);

        res.status(201).json({
            message: 'واریز با موفقیت ثبت شد',
            deposit,
            savedAmount,
            isCompleted: savedAmount >= goal.targetAmount,
        });
    } catch (error) {
        res.status(500).json({ message: 'خطای سرور', error: error.message });
    }
};

// ── تاریخچه‌ی واریزهای یک هدف (بدون تغییر) ──────────────────────────────────
exports.getGoalDeposits = async (req, res) => {
    try {
        const { id } = req.params;

        const goal = await Goal.findOne({ _id: id, userId: req.user.id });
        if (!goal) {
            return res.status(404).json({ message: 'هدف مورد نظر یافت نشد' });
        }

        const deposits = await Transaction.find({
            userId: req.user.id,
            goalId: goal._id,
            type: 'GOAL_DEPOSIT'
        }).sort({ date: -1 }).populate('cardId', 'name icon color').lean();

        res.status(200).json({ deposits });
    } catch (error) {
        res.status(500).json({ message: 'خطای سرور', error: error.message });
    }
};

// ── حذف هدف (بدون تغییر) ─────────────────────────────────────────────────────
exports.deleteGoal = async (req, res) => {
    try {
        const { id } = req.params;
        const deleteTransactions = req.query.deleteTransactions === 'true';

        const goal = await Goal.findOne({ _id: id, userId: req.user.id });
        if (!goal) {
            return res.status(404).json({ message: 'هدف مورد نظر یافت نشد' });
        }

        if (deleteTransactions) {
            await Transaction.deleteMany({ goalId: goal._id, userId: req.user.id, type: 'GOAL_DEPOSIT' });
        } else {
            await Transaction.updateMany(
                { goalId: goal._id, userId: req.user.id, type: 'GOAL_DEPOSIT' },
                { $set: { goalId: null } }
            );
        }

        await Goal.deleteOne({ _id: id });

        res.status(200).json({
            message: deleteTransactions
                ? 'هدف و واریزهای مربوطه حذف شدند'
                : 'هدف حذف شد و واریزها به‌عنوان تراکنش عادی باقی ماندند'
        });
    } catch (error) {
        res.status(500).json({ message: 'خطای سرور', error: error.message });
    }
};

// ── ویرایش هدف (بدون تغییر) ───────────────────────────────────────────────────
exports.updateGoal = async (req, res) => {
    try {
        const { id } = req.params;
        const { title, targetAmount, deadline } = req.body;

        if (targetAmount !== undefined && targetAmount <= 0) {
            return res.status(400).json({ message: 'مبلغ هدف باید بیشتر از صفر باشد' });
        }

        const updateFields = {};
        if (title !== undefined) updateFields.title = title;
        if (targetAmount !== undefined) updateFields.targetAmount = targetAmount;
        if (deadline !== undefined) updateFields.deadline = new Date(deadline);

        const goal = await Goal.findOneAndUpdate(
            { _id: id, userId: req.user.id },
            updateFields,
            { new: true, runValidators: true }
        );

        if (!goal) {
            return res.status(404).json({ message: 'هدف مورد نظر یافت نشد' });
        }

        res.status(200).json({ message: 'هدف با موفقیت ویرایش شد', goal });
    } catch (error) {
        res.status(500).json({ message: 'خطای سرور', error: error.message });
    }
};

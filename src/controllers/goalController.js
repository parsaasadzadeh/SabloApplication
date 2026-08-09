const Goal = require('../models/Goal');
const Transaction = require('../models/Transaction');
const mongoose = require('mongoose');

// محاسبه پیشرفت هدف بر اساس تراکنش‌های کاربر از تاریخ ساخت هدف
const calculateProgress = async (userId, goalCreatedAt) => {
    const stats = await Transaction.aggregate([
        {
            $match: {
                userId: new mongoose.Types.ObjectId(userId),
                date: { $gte: goalCreatedAt }
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

    // پس‌انداز = درآمد - مخارج - اقساط پرداخت شده
    const savedAmount = (income + loans) - (expense + installmentsPaid);
    return Math.max(0, savedAmount);
};

// پیش‌بینی زمان رسیدن به هدف بر اساس میانگین ماهانه
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

        const goalsWithProgress = await Promise.all(
            goals.map(async (goal) => {
                const savedAmount = await calculateProgress(req.user.id, goal.createdAt);
                const percent = Math.min(100, Math.round((savedAmount / goal.targetAmount) * 100));
                const predictedMonths = predictMonths(savedAmount, goal.targetAmount, goal.createdAt);
                const remaining = Math.max(0, goal.targetAmount - savedAmount);

                // چک کن deadline رسیده یا نه
                const isExpired = new Date() > new Date(goal.deadline);
                const isCompleted = savedAmount >= goal.targetAmount;

                return {
                    ...goal.toObject(),
                    savedAmount,
                    remaining,
                    percent,
                    predictedMonths,
                    isExpired,
                    isCompleted,
                };
            })
        );

        res.status(200).json({ goals: goalsWithProgress });
    } catch (error) {
        res.status(500).json({ message: 'خطای سرور', error: error.message });
    }
};

// ── ساخت هدف جدید ────────────────────────────────────────────────────────────
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

// ── حذف هدف ──────────────────────────────────────────────────────────────────
exports.deleteGoal = async (req, res) => {
    try {
        const { id } = req.params;

        const goal = await Goal.findOneAndDelete({ _id: id, userId: req.user.id });

        if (!goal) {
            return res.status(404).json({ message: 'هدف مورد نظر یافت نشد' });
        }

        res.status(200).json({ message: 'هدف با موفقیت حذف شد' });
    } catch (error) {
        res.status(500).json({ message: 'خطای سرور', error: error.message });
    }
};

// ── ویرایش هدف ───────────────────────────────────────────────────────────────
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

// controllers/cardController.js
const Card = require('../models/Card');
const Transaction = require('../models/Transaction');

const MAX_CARDS_PER_USER = 5;

// لیست کارت‌های کاربر
exports.getCards = async (req, res) => {
    try {
        const cards = await Card.find({ userId: req.user.id }).sort({ createdAt: 1 });
        res.status(200).json({ cards });
    } catch (error) {
        res.status(500).json({ message: 'خطای سرور', error: error.message });
    }
};

// ساخت کارت جدید
exports.createCard = async (req, res) => {
    try {
        const { name, icon, color, description } = req.body;

        const trimmedName = String(name ?? '').trim();
        if (!trimmedName) {
            return res.status(400).json({ message: 'نام کارت الزامی است' });
        }
        if (trimmedName.length > 40) {
            return res.status(400).json({ message: 'نام کارت نباید بیشتر از ۴۰ کاراکتر باشد' });
        }

        // چک سقف ۵ کارت
        const existingCount = await Card.countDocuments({ userId: req.user.id });
        if (existingCount >= MAX_CARDS_PER_USER) {
            return res.status(400).json({ 
                message: `حداکثر ${MAX_CARDS_PER_USER} کارت مجاز است` 
            });
        }

        // چک تکراری نبودن اسم
        const duplicate = await Card.findOne({
            userId: req.user.id,
            name: { $regex: `^${trimmedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' }
        });
        if (duplicate) {
            return res.status(400).json({ message: 'کارتی با این نام از قبل وجود دارد' });
        }

        const card = await Card.create({
            userId: req.user.id,
            name: trimmedName,
            icon: icon?.trim() || '💳',
            color: color?.trim() || '#6C63FF',
            description: description?.trim() || ''
        });

        res.status(201).json({ message: 'کارت با موفقیت ساخته شد', card });
    } catch (error) {
        res.status(500).json({ message: 'خطای سرور', error: error.message });
    }
};

// ویرایش کارت
exports.updateCard = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, icon, color, description } = req.body;

        const updateFields = {};

        if (name !== undefined) {
            const trimmedName = String(name).trim();
            if (!trimmedName) {
                return res.status(400).json({ message: 'نام کارت نمی‌تواند خالی باشد' });
            }
            if (trimmedName.length > 40) {
                return res.status(400).json({ message: 'نام کارت نباید بیشتر از ۴۰ کاراکتر باشد' });
            }

            // چک تکراری نبودن (به جز خود این کارت)
            const duplicate = await Card.findOne({
                userId: req.user.id,
                _id: { $ne: id },
                name: { $regex: `^${trimmedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' }
            });
            if (duplicate) {
                return res.status(400).json({ message: 'کارتی با این نام از قبل وجود دارد' });
            }

            updateFields.name = trimmedName;
        }

        if (icon !== undefined) updateFields.icon = icon.trim() || '💳';
        if (color !== undefined) updateFields.color = color.trim() || '#6C63FF';
        if (description !== undefined) updateFields.description = description.trim();

        const updatedCard = await Card.findOneAndUpdate(
            { _id: id, userId: req.user.id },
            updateFields,
            { new: true }
        );

        if (!updatedCard) {
            return res.status(404).json({ message: 'کارت مورد نظر یافت نشد' });
        }

        res.status(200).json({ message: 'کارت با موفقیت ویرایش شد', card: updatedCard });
    } catch (error) {
        res.status(500).json({ message: 'خطای سرور', error: error.message });
    }
};

// حذف کارت + تراکنش‌های مربوط بهش
// cardController.js - deleteCard
exports.deleteCard = async (req, res) => {
    try {
        const { id } = req.params;
        const deleteTransactions = req.query.deleteTransactions === 'true';

        const card = await Card.findOne({ _id: id, userId: req.user.id });
        if (!card) {
            return res.status(404).json({ message: 'کارت مورد نظر یافت نشد' });
        }

        if (deleteTransactions) {
            // کاربر خواست تراکنش‌ها هم پاک بشن
            await Transaction.deleteMany({ 
                cardId: card._id, 
                userId: req.user.id 
            });
        } else {
            // فقط cardId رو null کن، تراکنش‌ها بمونن
            await Transaction.updateMany(
                { cardId: card._id, userId: req.user.id },
                { $set: { cardId: null } }
            );
        }

        await Card.deleteOne({ _id: id });

        res.status(200).json({ 
            message: deleteTransactions 
                ? 'کارت و تراکنش‌های مربوطه حذف شدند'
                : 'کارت حذف شد و تراکنش‌ها حفظ شدند'
        });
    } catch (error) {
        res.status(500).json({ message: 'خطای سرور', error: error.message });
    }
};
// خلاصه مالی یه کارت خاص
exports.getCardStats = async (req, res) => {
    try {
        const { id } = req.params;
        const mongoose = require('mongoose');

        // چک که کارت متعلق به این کاربر باشه
        const card = await Card.findOne({ _id: id, userId: req.user.id });
        if (!card) {
            return res.status(404).json({ message: 'کارت مورد نظر یافت نشد' });
        }

        const stats = await Transaction.aggregate([
            {
                $match: {
                    userId: new mongoose.Types.ObjectId(req.user.id),
                    cardId: card._id
                }
            },
            {
                $group: {
                    _id: '$type',
                    totalAmount: { $sum: '$amount' },
                    count: { $sum: 1 }
                }
            }
        ]);

        let income = 0, expense = 0, transactionCount = 0;
        stats.forEach(item => {
            if (item._id === 'INCOME') income = item.totalAmount;
            if (item._id === 'EXPENSE') expense = item.totalAmount;
            transactionCount += item.count;
        });

        res.status(200).json({
            card,
            stats: {
                totalIncome: income,
                totalExpense: expense,
                balance: income - expense,
                transactionCount
            }
        });
    } catch (error) {
        res.status(500).json({ message: 'خطای سرور', error: error.message });
    }
};

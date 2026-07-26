const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: { 
        type: String, 
        enum: ['INCOME', 'EXPENSE', 'INSTALLMENT', 'LOAN'], 
        required: true 
    },
    amount: { type: Number, required: true },
    title: { type: String, required: true },
    description: { type: String },
    
    category: { type: String, default: 'عمومی' }, 
    
    loanId: { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction', default: null },
    
    dueDate: { type: Date }, 
    isPaid: { type: Boolean, default: false },
    
    date: { type: Date, default: Date.now }
}, { timestamps: true });

transactionSchema.index({ userId: 1, date: -1 });

module.exports = mongoose.model('Transaction', transactionSchema);

const express = require('express');
const router = express.Router();
const {
    addTransaction,
    getMyTransactions,
    exportTransactionsCSV,
    getFinanceStats,
    payInstallment,
    deleteTransaction,
    updateTransaction,
    getMonthlyComparison,
    getCategoryStats,
    getCategories,
    addCustomCategory,
    deleteCustomCategory,
    getMonthlyOverview,
    createLoanWithInstallments,
    getLoans, 
    getUnpaidInstallments  , 
    calculateDong , 
    saveDongAsExpense,
    createTransfer
} = require('../controllers/financeController');
const sms = require('../controllers/smsImportController');
const { protect } = require('../middlewares/authMiddleware');
router.use(protect);
router.post('/add', addTransaction);
router.get('/my-data', getMyTransactions);
router.get('/stats', getFinanceStats);
router.put('/pay-installment/:id', payInstallment);
router.put('/update/:id', updateTransaction);
router.delete('/delete/:id', deleteTransaction);
router.get('/monthly-comparison', getMonthlyComparison);
router.get('/export-csv', exportTransactionsCSV);
router.get('/categories', getCategories);
// ✅ ساخت و حذف دسته‌بندی شخصی کاربر
router.post('/categories/custom', addCustomCategory);
router.delete('/categories/custom/:id', deleteCustomCategory);
router.get('/category-stats', getCategoryStats);
router.get('/monthly-overview', getMonthlyOverview);
router.get('/unpaid-installments', getUnpaidInstallments);
//قسط و وام 
router.post('/loans/create', createLoanWithInstallments);
router.get('/loans', getLoans);

//ماشین حساب دنگ
router.post('/dong/calculate', calculateDong);
router.post('/dong/save', saveDongAsExpense);


//بانک
router.post('/sms/import', protect, sms.importSms);
router.get('/sms/pending', protect, sms.getPendingSms);
router.post('/sms/:id/confirm', protect, sms.confirmSms);
router.post('/sms/:id/reject', protect, sms.rejectSms);

//انتقال
router.post('/transfer',protect, createTransfer);
module.exports = router;



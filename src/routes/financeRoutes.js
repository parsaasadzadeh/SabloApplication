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
    getMonthlyOverview
} = require('../controllers/financeController');
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
module.exports = router;

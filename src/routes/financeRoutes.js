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
router.get('/category-stats', getCategoryStats);

module.exports = router;

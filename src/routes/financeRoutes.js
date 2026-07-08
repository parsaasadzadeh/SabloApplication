const express = require('express');
const router = express.Router();
const { addTransaction, getMyTransactions, getFinanceStats, payInstallment,deleteTransaction, updateTransaction } = require('../controllers/financeController');
const { protect } = require('../middlewares/authMiddleware');

router.use(protect); 

router.post('/add', addTransaction);
router.get('/my-data', getMyTransactions); // این روت صفحه بندی (Pagination) خواهد داشت
router.get('/stats', getFinanceStats); // آمار فوق حرفه‌ای و دقیق دیتابیس
router.put('/pay-installment/:id', payInstallment); // تسویه یا پرداخت قسط
router.put('/update/:id', updateTransaction);      // جدید: ویرایش تراکنش
router.delete('/delete/:id', deleteTransaction);   // جدید: حذف تراکنش

  
module.exports = router;

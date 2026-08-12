const express = require('express');
const router = express.Router();
const { addTransaction, getMyTransactions, getFinanceStats, payInstallment,deleteTransaction, updateTransaction, getMonthlyComparison } = require('../controllers/financeController');
const { protect } = require('../middlewares/authMiddleware');

router.use(protect); 

router.post('/add', addTransaction);
router.get('/my-data', getMyTransactions);
router.get('/stats', getFinanceStats); 
router.put('/pay-installment/:id', payInstallment); //   پرداخت قسط
router.put('/update/:id', updateTransaction);  
router.delete('/delete/:id', deleteTransaction);  
router.get('/monthly-comparison', getMonthlyComparison);
  
module.exports = router;


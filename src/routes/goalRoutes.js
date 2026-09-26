const express = require('express');
const router = express.Router();
const {
    getGoals,
    createGoal,
    deleteGoal,
    updateGoal,
    depositToGoal,
    getGoalDeposits
} = require('../controllers/goalController');
const { protect } = require('../middlewares/authMiddleware');

router.use(protect);

router.get('/', getGoals);
router.post('/', createGoal);
router.put('/:id', updateGoal);
router.delete('/:id', deleteGoal);
router.post('/:id/deposit', depositToGoal);
router.get('/:id/deposits', getGoalDeposits);
module.exports = router;

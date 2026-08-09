const express = require('express');
const router = express.Router();
const {
    getGoals,
    createGoal,
    deleteGoal,
    updateGoal
} = require('../controllers/goalController');
const { protect } = require('../middlewares/authMiddleware');

router.use(protect);

router.get('/', getGoals);
router.post('/', createGoal);
router.put('/:id', updateGoal);
router.delete('/:id', deleteGoal);

module.exports = router;

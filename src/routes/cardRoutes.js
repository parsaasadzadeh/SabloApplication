// routes/cardRoutes.js
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const {
    getCards,
    createCard,
    updateCard,
    deleteCard,
    getCardStats
} = require('../controllers/cardController');

router.use(protect); // همه route ها نیاز به auth دارن

router.get('/', getCards);
router.post('/', createCard);
router.put('/:id', updateCard);
router.delete('/:id', deleteCard);
router.get('/:id/stats', getCardStats);

module.exports = router;

const express = require('express');
const router = express.Router();
const { getAiAnalysis } = require('../controllers/aiController');
const { protect } = require('../middlewares/authMiddleware');

router.use(protect);
router.post('/analyze', getAiAnalysis);

module.exports = router;

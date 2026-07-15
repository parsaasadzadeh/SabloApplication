const express = require('express');
const router = express.Router();
const { getAiAnalysis, getAiStatus } = require('../controllers/aiController');
const { protect } = require('../middlewares/authMiddleware');

router.use(protect);
router.post('/analyze', getAiAnalysis);
router.get('/status', getAiStatus);

module.exports = router;

const express = require('express');
const router = express.Router();
const versionController = require('../controllers/version.controller');

// مسیر: GET /api/version/check
router.get('/check', versionController.checkVersion);

module.exports = router;

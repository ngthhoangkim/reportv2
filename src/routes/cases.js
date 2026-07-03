const express = require('express');
const { collectCase } = require('../modules/case-collector/collector');

const router = express.Router();

router.get('/api/cases/:fileNum', async (req, res) => {
  try {
    const data = await collectCase({ fileNum: req.params.fileNum });
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/api/cases/:fileNum/:sessionId', async (req, res) => {
  try {
    const data = await collectCase({ fileNum: req.params.fileNum, sessionId: req.params.sessionId });
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;

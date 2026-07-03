const express = require('express');
const db = require('../db/sqlServer');

const router = express.Router();

router.get('/health', async (req, res) => {
  try {
    const sql = await db.healthCheck();
    res.json({ ok: true, sql });
  } catch (err) {
    res.status(503).json({ ok: false, error: err.message });
  }
});

module.exports = router;

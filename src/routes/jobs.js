const express = require('express');
const state = require('../modules/state/stateStore');
const defaults = require('../config/defaults');
const { cleanupOutputByDateRange } = require('../config/paths');

const router = express.Router();

router.get('/api/jobs/recent', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || defaults.logging.maxLinesRecent, 500);
  res.json({
    ok: true,
    generated: state.readJsonlRecent('generated-files.jsonl', limit),
    failed: state.readJsonlRecent('failed-jobs.jsonl', limit),
    failedUploads: state.readJsonlRecent('failed-uploads.jsonl', limit),
  });
});

// POST /api/jobs/cleanup-output
// Body: { from: "2026-09-01", to: "2026-09-19" }  (to mặc định là hiện tại nếu bỏ qua)
router.post('/api/jobs/cleanup-output', async (req, res) => {
  try {
    const { from, to } = req.body || {};
    if (!from) return res.status(400).json({ ok: false, error: 'from date is required (YYYY-MM-DD)' });
    const toDate = to ? `${to}T23:59:59.999Z` : new Date().toISOString();
    const fromDate = `${from}T00:00:00.000Z`;
    const result = await cleanupOutputByDateRange(fromDate, toDate);
    res.json({ ok: true, from: fromDate, to: toDate, ...result });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

module.exports = router;

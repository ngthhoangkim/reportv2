const express = require('express');
const state = require('../modules/state/stateStore');
const defaults = require('../config/defaults');

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

module.exports = router;

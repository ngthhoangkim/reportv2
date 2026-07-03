const express = require('express');
const { generateReportSafe } = require('../modules/report-renderer/reportGenerator');
const { runBackfill } = require('../scripts/backfillRunner');

const router = express.Router();

router.post('/api/reports/generate', async (req, res) => {
  const result = await generateReportSafe({
    fileNum: req.body.fileNum,
    sessionId: req.body.sessionId,
    resultFileName: req.body.resultFileName,
    force: Boolean(req.body.force),
    upload: Boolean(req.body.upload),
  });
  res.status(result.ok === false ? 500 : 200).json(result);
});

router.post('/api/backfill', async (req, res) => {
  const result = await runBackfill({
    date: req.body.date,
    from: req.body.from,
    to: req.body.to,
    fileNum: req.body.fileNum,
    sessionId: req.body.sessionId,
    dryRun: Boolean(req.body.dryRun),
    force: Boolean(req.body.force),
    failedOnly: Boolean(req.body.failedOnly),
    upload: Boolean(req.body.upload),
    types: req.body.types,
  });
  res.status(result.ok === false ? 500 : 200).json(result);
});

module.exports = router;

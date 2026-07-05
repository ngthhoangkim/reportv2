const express = require('express');
const { generatePrescriptionsSafe } = require('../modules/prescription/prescriptionGenerator');
const { runPrescriptionBackfill } = require('../scripts/backfillPrescriptionsRunner');

const router = express.Router();

router.post('/api/prescriptions/generate', async (req, res) => {
  const result = await generatePrescriptionsSafe({
    fileNum: req.body.fileNum,
    sessionId: req.body.sessionId,
    progressId: req.body.progressId,
    upload: Boolean(req.body.upload),
    force: Boolean(req.body.force),
  });
  res.status(result.ok === false ? 500 : 200).json(result);
});

router.post('/api/prescriptions/backfill', async (req, res) => {
  const result = await runPrescriptionBackfill({
    date: req.body.date,
    from: req.body.from,
    to: req.body.to,
    fileNum: req.body.fileNum,
    sessionId: req.body.sessionId,
    progressId: req.body.progressId,
    dryRun: Boolean(req.body.dryRun),
    force: Boolean(req.body.force),
    failedOnly: Boolean(req.body.failedOnly),
    upload: Boolean(req.body.upload),
  });
  res.status(result.ok === false ? 500 : 200).json(result);
});

module.exports = router;

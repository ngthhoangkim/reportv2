const express = require('express');
const { ensureAppDirs } = require('./config/paths');
const logger = require('./modules/logging/logger');
const healthRoutes = require('./routes/health');
const caseRoutes = require('./routes/cases');
const reportRoutes = require('./routes/reports');
const prescriptionRoutes = require('./routes/prescriptions');
const jobRoutes = require('./routes/jobs');

function createApp() {
  ensureAppDirs();
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  app.use((req, res, next) => {
    res.on('finish', () => {
      logger.app('info', 'http request', {
        method: req.method,
        path: req.path,
        status: res.statusCode,
      });
    });
    next();
  });

  app.use(healthRoutes);
  app.use(caseRoutes);
  app.use(reportRoutes);
  app.use(prescriptionRoutes);
  app.use(jobRoutes);

  app.use((req, res) => {
    res.status(404).json({ ok: false, error: 'Not found' });
  });

  app.use((err, req, res, next) => {
    logger.error('http error', { error: err.message, stack: err.stack });
    res.status(500).json({ ok: false, error: err.message });
  });

  return app;
}

module.exports = { createApp };

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const config = require('./config');
const { query } = require('./db');
const { notFoundHandler, errorHandler } = require('./middleware/errors');

function createApp() {
  const app = express();
  if (config.trustProxy !== false) app.set('trust proxy', config.trustProxy);
  app.disable('x-powered-by');

  app.use(helmet());
  app.use(cors({ origin: config.corsOrigins.length ? config.corsOrigins : true }));
  app.use(express.json({ limit: '100kb' }));

  if (config.env !== 'test') {
    app.use((req, res, next) => {
      const start = Date.now();
      res.on('finish', () => console.log(`${req.method} ${req.originalUrl.split('?')[0]} ${res.statusCode} ${Date.now() - start}ms`));
      next();
    });
  }

  app.get('/health', async (req, res) => {
    try {
      await query('SELECT 1');
      res.json({ status: 'ok' });
    } catch {
      res.status(503).json({ status: 'database_unavailable' });
    }
  });

  app.use('/api/v1/auth', require('./routes/auth'));
  app.use('/api/v1/incidents', require('./routes/incidents'));
  app.use('/api/v1/ussd', require('./routes/ussd'));
  app.use('/api/v1/admin', require('./routes/admin'));
  app.use('/api/v1', require('./routes/resources')); // /hospitals, /ambulances/me/*, /police-units/me/*

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };

'use strict';

/**
 * src/routes/health.js
 *
 * GET /api/health
 *
 * Returns server status and database connectivity.
 * Used by Postman, monitoring tools, and the demonstration.
 * No authentication required.
 */

const router = require('express').Router();
const db     = require('../database/db');

router.get('/health', (req, res) => {
  // Attempt a trivial database read to confirm connectivity
  let dbStatus = 'connected';
  let dbError  = null;

  try {
    db.prepare('SELECT 1 AS ok').get();
  } catch (err) {
    dbStatus = 'error';
    dbError  = 'Database query failed';
  }

  const status = dbStatus === 'connected' ? 'ok' : 'degraded';

  return res.status(dbStatus === 'connected' ? 200 : 503).json({
    status,
    timestamp:   new Date().toISOString(),
    uptime_s:    Math.floor(process.uptime()),
    node_version: process.version,
    environment: process.env.NODE_ENV || 'development',
    database:    dbStatus,
    ...(dbError && { db_error: dbError }),
  });
});

module.exports = router;

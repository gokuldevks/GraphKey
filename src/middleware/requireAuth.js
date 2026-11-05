'use strict';

/**
 * src/middleware/requireAuth.js
 *
 * Express middleware that protects routes requiring an active session.
 *
 * Usage:
 *   const requireAuth = require('../middleware/requireAuth');
 *   router.get('/protected', requireAuth, handler);
 *
 * Returns HTTP 401 if no valid session exists.
 * Does NOT redirect — this is an API, so the frontend handles navigation.
 */

function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ message: 'Authentication required. Please log in.' });
  }
  next();
}

module.exports = requireAuth;

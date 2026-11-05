'use strict';

/**
 * src/middleware/csrfProtection.js
 *
 * Double-submit session CSRF protection.
 *
 * HOW IT WORKS (simple English):
 *   1. When a page loads it calls GET /api/csrf-token.
 *      The server generates a random token and stores it inside the user's
 *      session (server-side, in SQLite).  It sends the token to the browser.
 *   2. The browser stores that token in a JavaScript variable (not a cookie).
 *   3. Every state-changing request (POST/PUT/DELETE) includes the token in
 *      an HTTP header called X-CSRF-Token.
 *   4. This middleware compares the header value against the session value
 *      using a timing-safe comparison (crypto.timingSafeEqual).
 *   5. If they match → request proceeds.
 *      If they don't match → 403 Forbidden.
 *
 * WHY THIS STOPS CSRF ATTACKS:
 *   A malicious website on a different origin can make the victim's browser
 *   send the session cookie automatically — but it CANNOT read our CSRF token
 *   because that token is only in a JS variable on our page (same-origin policy).
 *   Without the correct token in the header, the attack is blocked here.
 *
 * NOTE: sameSite: 'strict' on the session cookie is a first line of defence.
 * This middleware adds defence-in-depth for browsers or proxies that mishandle
 * the SameSite attribute.
 */

const crypto = require('crypto');

// Header name the client must send
const CSRF_HEADER = 'x-csrf-token';

// HTTP methods that cannot change state — no CSRF check needed for these
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * generateCsrfToken()
 * Returns a 64-character hex string (32 random bytes).
 * Exported so the login handler can issue a fresh token after session.regenerate().
 */
function generateCsrfToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * csrfProtection middleware
 * Apply AFTER session middleware and BEFORE any state-changing route handlers.
 *
 * Returns 403 when:
 *   - The request method is POST, PUT, PATCH, or DELETE AND
 *   - Either the session has no CSRF token or the header is missing/wrong.
 */
function csrfProtection(req, res, next) {
  // Safe methods never change state — skip validation entirely
  if (SAFE_METHODS.has(req.method.toUpperCase())) {
    return next();
  }

  const sessionToken = req.session && req.session.csrfToken;
  const headerToken  = req.headers[CSRF_HEADER];

  // Both must be present
  if (!sessionToken || !headerToken) {
    return res.status(403).json({
      message: 'CSRF token missing. Please refresh the page and try again.',
    });
  }

  // Both must be valid 64-char hex strings before we pass them to timingSafeEqual
  const hexPattern = /^[0-9a-f]{64}$/i;
  if (!hexPattern.test(sessionToken) || !hexPattern.test(headerToken)) {
    return res.status(403).json({
      message: 'CSRF token invalid. Please refresh the page and try again.',
    });
  }

  // Timing-safe comparison — prevents byte-by-byte guessing of the token
  const sessionBuf = Buffer.from(sessionToken, 'hex');
  const headerBuf  = Buffer.from(headerToken,  'hex');

  let tokensMatch = false;
  try {
    tokensMatch = crypto.timingSafeEqual(sessionBuf, headerBuf);
  } catch (_) {
    tokensMatch = false;
  }

  if (!tokensMatch) {
    return res.status(403).json({
      message: 'CSRF token mismatch. Please refresh the page and try again.',
    });
  }

  return next();
}

module.exports = { csrfProtection, generateCsrfToken, CSRF_HEADER };

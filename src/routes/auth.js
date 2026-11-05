'use strict';

/**
 * src/routes/auth.js
 *
 * Authentication API routes — Stage 4 (full implementation).
 *
 *   POST /api/register  — Create a new account
 *   POST /api/login     — Authenticate with graphical password
 *   GET  /api/me        — Get current user info (session required)
 *   POST /api/logout    — Destroy session
 *
 * Security properties enforced here:
 *  - Raw point sequences are NEVER stored, logged, or returned to any client
 *  - Dummy PBKDF2 runs on unknown usernames (prevents timing-based enumeration)
 *  - Session is regenerated on login (prevents session-fixation attacks)
 *  - Login rate-limited to 10 attempts per 15 minutes per IP
 *  - All DB queries use prepared statements (no SQL injection)
 *  - Audit event written for every register / login-ok / login-fail / logout
 */

const router      = require('express').Router();
const rateLimit   = require('express-rate-limit');
const db          = require('../database/db');
const { generateSalt, deriveVerifier, verifyPassword } = require('../services/crypto');
const { validatePoints, serializePoints }              = require('../services/passwordService');
const { VALID_IMAGE_IDS }                              = require('./images');
const requireAuth                                      = require('../middleware/requireAuth');
const { generateCsrfToken }                           = require('../middleware/csrfProtection');

// ── Login Rate Limiter ───────────────────────────────────────────
// 10 attempts per IP per 15-minute window, regardless of success/failure.
// express-rate-limit v8 uses `limit` instead of the old `max`.
const loginLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,
  limit:           10,
  message:         { message: 'Too many login attempts. Please wait 15 minutes and try again.' },
  standardHeaders: 'draft-7',
  legacyHeaders:   false,
  // Count every attempt (not just failures) so a bot can't simply
  // keep trying correct passwords at the edge of the window.
  skipSuccessfulRequests: false,
});

// ── Prepared Statements (created once at startup) ────────────────
// Using prepared statements provides two benefits:
//   1. SQL injection is impossible — values are parameterised
//   2. The statement is compiled once and reused efficiently
const stmtFindUser = db.prepare(
  'SELECT id, username, image_id, salt, verifier, iterations, created_at ' +
  'FROM users WHERE username = ?'
);

const stmtInsertUser = db.prepare(
  'INSERT INTO users (username, image_id, salt, verifier, iterations) ' +
  'VALUES (@username, @image_id, @salt, @verifier, @iterations)'
);

const stmtGetUserById = db.prepare(
  'SELECT id, username, image_id, iterations, created_at FROM users WHERE id = ?'
);

const stmtInsertAudit = db.prepare(
  'INSERT INTO audit_events (user_id, event_type, ip_address) ' +
  'VALUES (@user_id, @event_type, @ip_address)'
);

// ── Helpers ──────────────────────────────────────────────────────

/**
 * logAudit — writes a row to audit_events.
 * Failures are silently swallowed so they don't mask the real response.
 * NEVER log passwords, points, salts, or session IDs here.
 */
function logAudit(userId, eventType, req) {
  try {
    stmtInsertAudit.run({
      user_id:    userId ?? null,
      event_type: eventType,
      ip_address: req.ip || null,
    });
  } catch (err) {
    console.error('[AUDIT] Failed to write audit event:', err.message);
  }
}

/**
 * validateUsername — server-side username check.
 * Returns true only for 3-32 character strings of [a-zA-Z0-9_].
 */
function validateUsername(value) {
  if (typeof value !== 'string') return false;
  const s = value.trim();
  return s.length >= 3 && s.length <= 32 && /^[a-zA-Z0-9_]+$/.test(s);
}

// ── POST /api/register ───────────────────────────────────────────
/**
 * Request body: { username, imageId, points }
 *   points: [[gridX, gridY], [gridX, gridY], [gridX, gridY], [gridX, gridY]]
 *
 * Success: 201 { message, username }
 * Errors:  400 (invalid input) | 409 (username taken) | 500 (server error)
 */
router.post('/register', async (req, res) => {
  const { username, imageId, points } = req.body ?? {};

  // ── Input Validation ─────────────────────────────────────────
  if (!validateUsername(username)) {
    return res.status(400).json({
      message: 'Username must be 3–32 characters using only letters, numbers, and underscores.',
    });
  }

  if (!VALID_IMAGE_IDS.has(imageId)) {
    return res.status(400).json({ message: 'Invalid image ID. Please select one of the provided images.' });
  }

  const pointCheck = validatePoints(points);
  if (!pointCheck.valid) {
    return res.status(400).json({ message: pointCheck.reason });
  }

  const normalizedUsername = username.trim().toLowerCase();

  // ── Duplicate Username Check ─────────────────────────────────
  const existing = stmtFindUser.get(normalizedUsername);
  if (existing) {
    return res.status(409).json({ message: 'Username already taken. Please choose a different one.' });
  }

  // ── Derive Verifier (PBKDF2-SHA256) ─────────────────────────
  const salt       = generateSalt();
  const iterations = parseInt(process.env.PBKDF2_ITERATIONS, 10) || 210000;

  // Serialize points into canonical string — this is the "raw password".
  // It is used only here and immediately discarded after deriveVerifier().
  const pointString = serializePoints(imageId, points);

  let verifier;
  try {
    verifier = await deriveVerifier(pointString, salt, iterations);
  } catch (err) {
    console.error('[REGISTER] PBKDF2 derivation error:', err.message);
    return res.status(500).json({ message: 'Registration failed due to a server error. Please try again.' });
  }

  // ── Insert User into Database ────────────────────────────────
  // The verifier (hash) is stored — never the raw points or pointString.
  let insertedId;
  try {
    const result = stmtInsertUser.run({
      username:  normalizedUsername,
      image_id:  imageId,
      salt,
      verifier,
      iterations,
    });
    insertedId = result.lastInsertRowid;
  } catch (err) {
    if (err.message.includes('UNIQUE constraint failed')) {
      // Race condition: another request registered the same username
      return res.status(409).json({ message: 'Username already taken. Please choose a different one.' });
    }
    console.error('[REGISTER] Database insert error:', err.message);
    return res.status(500).json({ message: 'Registration failed due to a server error. Please try again.' });
  }

  // ── Audit Log ────────────────────────────────────────────────
  logAudit(insertedId, 'REGISTER', req);

  return res.status(201).json({
    message:  'Account created successfully. You can now log in.',
    username: normalizedUsername,
  });
});

// ── POST /api/login ──────────────────────────────────────────────
/**
 * Request body: { username, imageId, points }
 *
 * Success: 200 { message, username }
 * Errors:  400 (invalid input) | 401 (wrong credentials) |
 *          429 (rate limited)  | 500 (server error)
 *
 * Security note: Runs PBKDF2 even when username is not found, so an
 * attacker cannot distinguish "wrong username" from "wrong password"
 * via response timing.
 */
router.post('/login', loginLimiter, async (req, res) => {
  const { username, imageId, points } = req.body ?? {};

  // ── Input Validation ─────────────────────────────────────────
  if (!validateUsername(username)) {
    return res.status(400).json({ message: 'Invalid username format.' });
  }

  if (!VALID_IMAGE_IDS.has(imageId)) {
    return res.status(400).json({ message: 'Invalid image ID.' });
  }

  const pointCheck = validatePoints(points);
  if (!pointCheck.valid) {
    return res.status(400).json({ message: pointCheck.reason });
  }

  const normalizedUsername = username.trim().toLowerCase();

  // ── User Lookup ──────────────────────────────────────────────
  const user = stmtFindUser.get(normalizedUsername);

  // Use real values if user exists; dummy values if not.
  // This ensures the PBKDF2 computation always takes the same time,
  // making it impossible to enumerate valid usernames via timing.
  const saltForPbkdf2 = user
    ? user.salt
    : generateSalt();                                              // dummy salt

  const iterForPbkdf2 = user
    ? user.iterations
    : (parseInt(process.env.PBKDF2_ITERATIONS, 10) || 210000);   // dummy iter

  // ── Build Candidate Point String ─────────────────────────────
  const candidatePointString = serializePoints(imageId, points);

  // ── Verify ───────────────────────────────────────────────────
  let matched = false;
  try {
    if (!user) {
      // Run dummy PBKDF2 and discard result — timing parity only.
      await deriveVerifier(candidatePointString, saltForPbkdf2, iterForPbkdf2);
      matched = false;
    } else if (user.image_id !== imageId) {
      // Wrong image — run PBKDF2 for timing parity, then reject.
      await deriveVerifier(candidatePointString, saltForPbkdf2, iterForPbkdf2);
      matched = false;
    } else {
      // Real comparison using timingSafeEqual
      matched = await verifyPassword(
        candidatePointString,
        user.verifier,
        user.salt,
        user.iterations
      );
    }
  } catch (err) {
    console.error('[LOGIN] Verification error:', err.message);
    return res.status(500).json({ message: 'Login failed due to a server error.' });
  }

  // ── Wrong Credentials ────────────────────────────────────────
  if (!matched) {
    logAudit(user?.id ?? null, 'LOGIN_FAIL', req);
    // Generic message — do not reveal whether username exists
    return res.status(401).json({ message: 'Incorrect username or graphical password.' });
  }

  // ── Success: Regenerate Session (Session-Fixation Prevention) ─
  // regenerate() creates a brand-new session ID, invalidating any
  // pre-login session the client may have held.
  req.session.regenerate(err => {
    if (err) {
      console.error('[LOGIN] Session regenerate error:', err.message);
      return res.status(500).json({ message: 'Login failed due to a server error.' });
    }

    // Store only user ID and username — not the graphical password
    req.session.userId   = user.id;
    req.session.username = user.username;

    // Issue a fresh CSRF token bound to this new authenticated session.
    // The browser must use this token (not the pre-login one) for all
    // subsequent state-changing requests.
    req.session.csrfToken = generateCsrfToken();

    // Persist the session to the SQLite store before responding
    req.session.save(saveErr => {
      if (saveErr) {
        console.error('[LOGIN] Session save error:', saveErr.message);
        return res.status(500).json({ message: 'Login failed due to a server error.' });
      }

      logAudit(user.id, 'LOGIN_OK', req);

      return res.json({
        message:   'Login successful.',
        username:  user.username,
        csrfToken: req.session.csrfToken,  // fresh token for the new session
      });
    });
  });
});

// ── GET /api/me ──────────────────────────────────────────────────
/**
 * Returns the current user's public profile.
 * Requires an active session (enforced by requireAuth middleware).
 *
 * Returns safe fields only — never verifier, salt, or any credential.
 */
router.get('/me', requireAuth, (req, res) => {
  const user = stmtGetUserById.get(req.session.userId);

  if (!user) {
    // Session references a user that no longer exists
    req.session.destroy(() => {});
    return res.status(401).json({ message: 'User account not found. Session invalidated.' });
  }

  return res.json({
    user: {
      id:         user.id,
      username:   user.username,
      image_id:   user.image_id,
      iterations: user.iterations,
      created_at: user.created_at,
    },
  });
});

// ── POST /api/logout ─────────────────────────────────────────────
/**
 * Destroys the server-side session and clears the session cookie.
 * Requires an active session (enforced by requireAuth middleware).
 */
router.post('/logout', requireAuth, (req, res) => {
  const userId     = req.session.userId;
  const cookieName = req.app.get('sessionCookieName') || 'gk_sid';

  logAudit(userId, 'LOGOUT', req);

  req.session.destroy(err => {
    if (err) {
      console.error('[LOGOUT] Session destroy error:', err.message);
      return res.status(500).json({ message: 'Logout failed. Please try again.' });
    }

    // Instruct the browser to delete the session cookie
    res.clearCookie(cookieName, { httpOnly: true, sameSite: 'strict' });

    return res.json({ message: 'Logged out successfully.' });
  });
});

module.exports = router;

'use strict';

/**
 * server.js — GraphKey Express Application
 *
 * Entry point for the GraphKey graphical password authentication server.
 *
 * Startup order:
 *   1. Load environment variables from .env
 *   2. Validate required secrets are present
 *   3. Open SQLite database (also creates schema on first run)
 *   4. Configure Express middleware stack
 *   5. Mount API routes
 *   6. Serve static frontend files
 *   7. Start HTTP server
 *
 * Run with:  node server.js
 */

// ── 1. Load environment variables FIRST ─────────────────────────
require('dotenv').config();

// ── 2. Validate required environment variables ───────────────────
// Fail fast with a clear message rather than a cryptic crash later.
const REQUIRED_ENV = ['SESSION_SECRET', 'PBKDF2_ITERATIONS'];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`[FATAL] Missing required environment variable: ${key}`);
    console.error('        Copy .env.example to .env and fill in the values.');
    process.exit(1);
  }
}

// Guard against accidentally using weak/example secrets in production
if (
  process.env.NODE_ENV === 'production' &&
  process.env.SESSION_SECRET.includes('REPLACE_WITH')
) {
  console.error('[FATAL] SESSION_SECRET looks like a placeholder. Set a real secret in production.');
  process.exit(1);
}

// ── 3. Imports ───────────────────────────────────────────────────
const path    = require('path');
const express = require('express');
const session = require('express-session');
const helmet  = require('helmet');

// Database — opens connection + creates schema (runs once on first start)
const db           = require('./src/database/db');
const sessionStore = require('./src/database/sessionStore');

// Routes
const healthRouter = require('./src/routes/health');
const imagesRouter = require('./src/routes/images');
const authRouter   = require('./src/routes/auth');

// Security middleware
const { csrfProtection, generateCsrfToken } = require('./src/middleware/csrfProtection');

// ── 4. App + constants ───────────────────────────────────────────
const app    = express();
const PORT   = parseInt(process.env.PORT, 10) || 3000;
const isProd = process.env.NODE_ENV === 'production';
const COOKIE_NAME = 'gk_sid';

// Share cookie name with routes (used for clearCookie in logout)
app.set('sessionCookieName', COOKIE_NAME);

// ── 5. Trust proxy (needed for rate-limit IP detection behind Nginx/etc.)
if (isProd) {
  app.set('trust proxy', 1);
}

// ── 6. Security Headers — Helmet ────────────────────────────────
// Helmet sets many protective HTTP headers automatically.
// We customise CSP to allow our own scripts, styles, and SVG images.
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc:     ["'self'"],
        scriptSrc:      ["'self'"],
        // 'unsafe-inline' for style attributes used in dashboard.html
        styleSrc:       ["'self'", "'unsafe-inline'"],
        imgSrc:         ["'self'", 'data:'],
        connectSrc:     ["'self'"],
        fontSrc:        ["'self'"],
        objectSrc:      ["'none'"],
        frameSrc:       ["'none'"],
        baseUri:        ["'self'"],
        formAction:     ["'self'"],
        upgradeInsecureRequests: isProd ? [] : null,
      },
    },
    // Required for loading SVG images from the same origin
    crossOriginEmbedderPolicy: false,
  })
);

// ── 7. Body Parsing ──────────────────────────────────────────────
// Parse JSON bodies (for API requests).
app.use(express.json({ limit: '16kb' }));
// Parse URL-encoded bodies (browser form fallback).
app.use(express.urlencoded({ extended: false, limit: '16kb' }));

// ── 8. Session Middleware ────────────────────────────────────────
// Uses SQLite-backed store (not MemoryStore) for persistence.
// Cookie settings enforce security: HttpOnly, SameSite, Secure in prod.
app.use(
  session({
    store:  sessionStore,
    secret: process.env.SESSION_SECRET,
    name:   COOKIE_NAME,

    // Do NOT save unchanged sessions (performance + security)
    resave: false,

    // Do NOT create a session until the user authenticates
    saveUninitialized: false,

    // Extend cookie lifetime on each request (sliding expiry)
    rolling: true,

    cookie: {
      // Prevent JavaScript from reading the cookie (XSS protection)
      httpOnly: true,

      // Prevent cookie from being sent in cross-site requests (CSRF protection)
      sameSite: 'strict',

      // HTTPS only in production — HTTP allowed in development
      secure: isProd,

      // 30-minute idle timeout
      maxAge: 30 * 60 * 1000,
    },
  })
);

// ── 9. Request Logger (development only) ────────────────────────
if (!isProd) {
  app.use((req, res, next) => {
    // NEVER log request bodies — they may contain passwords or points
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
  });
}

// ── 10. Static Files ─────────────────────────────────────────────
// Serve HTML, CSS, JS, and SVG images from the public/ directory.
app.use(
  express.static(path.join(__dirname, 'public'), {
    index:    'index.html',
    etag:     true,
    maxAge:   isProd ? '1h' : 0,
  })
);

// ── 11. API Cache-Control ─────────────────────────────────────────
// Prevents browsers and proxies from caching API responses.
// Auth responses and session data must NEVER be served from cache.
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  next();
});

// ── 12. CSRF Token Endpoint ───────────────────────────────────────
// GET /api/csrf-token
// Every page calls this on load. A random 64-char hex token is stored
// server-side in the SQLite session. The browser must echo it back
// in the X-CSRF-Token header on every POST/PUT/DELETE request.
app.get('/api/csrf-token', (req, res) => {
  if (!req.session.csrfToken) {
    req.session.csrfToken = generateCsrfToken();
  }
  // saveUninitialized is false, so we must explicitly persist the session
  req.session.save(err => {
    if (err) {
      console.error('[CSRF] Session save error:', err.message);
      return res.status(500).json({ message: 'Session error. Please refresh the page.' });
    }
    return res.json({ csrfToken: req.session.csrfToken });
  });
});

// ── 13. API Routes ────────────────────────────────────────────────
// Health and images are GET-only — mount before CSRF middleware.
app.use('/api', healthRouter);
app.use('/api', imagesRouter);

// Apply CSRF protection to all state-changing routes below.
// The middleware is a no-op for GET/HEAD/OPTIONS requests.
app.use('/api', csrfProtection);

// Auth routes — register, login, me, logout
app.use('/api', authRouter);

// ── 14. SPA Fallback for HTML pages ──────────────────────────────
// Unknown non-API routes → serve index.html (lets browser handle routing)
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    // API endpoint not found — return JSON 404
    return res.status(404).json({ message: `API endpoint '${req.path}' not found.` });
  }
  // Unknown page — send index.html (browser handles unknown /foo.html paths)
  res.status(404).sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── 15. Global Error Handler ──────────────────────────────────────
// Catches errors thrown or passed via next(err) in route handlers.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  // Log stack trace only — NEVER log request body (may contain passwords)
  console.error('[ERROR]', err.stack || err.message);

  const status = err.status || err.statusCode || 500;

  // Return a safe, generic message — no stack traces to the client
  return res.status(status).json({
    message: isProd
      ? 'An internal server error occurred.'
      : err.message || 'An internal server error occurred.',
  });
});

// ── 16. Start Server ──────────────────────────────────────────────
let server;
if (require.main === module) {
  server = app.listen(PORT, () => {
    console.log('');
    console.log('  ╔═══════════════════════════════════════╗');
    console.log('  ║         GraphKey Server Ready         ║');
    console.log('  ╠═══════════════════════════════════════╣');
    console.log(`  ║  URL  : http://localhost:${PORT}         ║`);
    console.log(`  ║  Env  : ${(process.env.NODE_ENV || 'development').padEnd(30)}║`);
    console.log('  ║  DB   : data/graphkey.db              ║');
    console.log('  ╚═══════════════════════════════════════╝');
    console.log('');
    console.log('  Endpoints:');
    console.log('    GET  /api/health      — Server status');
    console.log('    GET  /api/images      — Available password images');
    console.log('    GET  /api/csrf-token  — Retrieve CSRF token');
    console.log('    POST /api/register    — Create account');
    console.log('    POST /api/login       — Authenticate');
    console.log('    GET  /api/me          — Current user profile');
    console.log('    POST /api/logout      — End session');
    console.log('');
  });

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT',  () => gracefulShutdown('SIGINT'));
}

// ── 17. Graceful Shutdown ─────────────────────────────────────────
function gracefulShutdown(signal) {
  console.log(`\n[SHUTDOWN] Received ${signal}. Closing server…`);
  if (server) {
    server.close(() => {
      console.log('[SHUTDOWN] HTTP server closed.');
      try {
        db.close();
        console.log('[SHUTDOWN] Database connection closed.');
      } catch (_) {}
      process.exit(0);
    });

    setTimeout(() => {
      console.error('[SHUTDOWN] Forced exit after timeout.');
      process.exit(1);
    }, 5000).unref();
  } else {
    try { db.close(); } catch (_) {}
    process.exit(0);
  }
}

module.exports = app; // exported for testing

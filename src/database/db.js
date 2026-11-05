'use strict';

/**
 * src/database/db.js
 *
 * Opens the SQLite database and creates the schema on first run.
 * Exports the better-sqlite3 db instance for use throughout the app.
 *
 * Tables created here:
 *   users        — stores registered accounts (never raw passwords)
 *   audit_events — logs every login/register/logout event
 *
 * The sessions table is created separately by the session store module.
 */

const path = require('path');
const fs   = require('fs');
const Database = require('better-sqlite3');

// ── Resolve database path ────────────────────────────────────────
// Stored in <project-root>/data/graphkey.db
const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const DB_PATH  = path.join(DATA_DIR, 'graphkey.db');

// Create data/ directory if it does not exist
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// ── Open database ────────────────────────────────────────────────
const db = new Database(DB_PATH);

// ── Performance & integrity pragmas ─────────────────────────────
// WAL mode: faster writes, allows concurrent reads
db.pragma('journal_mode = WAL');
// Enforce foreign key constraints
db.pragma('foreign_keys = ON');
// NORMAL is safe with WAL and much faster than FULL
db.pragma('synchronous = NORMAL');

// ── Schema ───────────────────────────────────────────────────────
// Using a transaction so both tables are created atomically.
db.transaction(() => {
  // ── users ──────────────────────────────────────────────────────
  // IMPORTANT: raw graphical password points are NEVER stored here.
  // Only the PBKDF2 verifier (a hash), salt, and iterations are kept.
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      username    TEXT    NOT NULL UNIQUE COLLATE NOCASE,
      image_id    TEXT    NOT NULL,
      salt        TEXT    NOT NULL,
      verifier    TEXT    NOT NULL,
      iterations  INTEGER NOT NULL,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // ── audit_events ───────────────────────────────────────────────
  // Records every security-relevant event.
  // NEVER log raw passwords, points, salts, or session secrets here.
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_events (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER,
      event_type  TEXT    NOT NULL,
      ip_address  TEXT,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    );
  `);

  // ── Index for fast audit lookups by user ───────────────────────
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_audit_user_id
      ON audit_events(user_id);
  `);

  // ── Index for fast username lookups (case-insensitive) ─────────
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_users_username
      ON users(username COLLATE NOCASE);
  `);
})();

console.log('[DB] Connected:', DB_PATH);

module.exports = db;

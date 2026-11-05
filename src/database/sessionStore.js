'use strict';

/**
 * src/database/sessionStore.js
 *
 * Creates a persistent, SQLite-backed session store for express-session.
 *
 * Why NOT the default MemoryStore?
 *   - MemoryStore leaks memory as sessions accumulate
 *   - All sessions are lost every time the server restarts
 *   - MemoryStore is explicitly labelled "not designed for production"
 *
 * This store writes session data to the same graphkey.db database
 * in a "sessions" table managed automatically by the library.
 * Expired sessions are cleaned up every 15 minutes.
 */

const session      = require('express-session');
const StoreFactory = require('better-sqlite3-session-store');
const db           = require('./db');

// The library uses the factory pattern: pass the session object
// and it returns a class that extends session.Store correctly.
const SqliteStore = StoreFactory(session);

const store = new SqliteStore({
  // Reuse the same database connection as the rest of the app.
  // The library will create a "sessions" table if it doesn't exist.
  client: db,

  // Automatically delete expired sessions
  expired: {
    clear: true,
    intervalMs: 15 * 60 * 1000, // every 15 minutes
  },
});

module.exports = store;

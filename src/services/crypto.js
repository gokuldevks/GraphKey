'use strict';

/**
 * src/services/crypto.js
 *
 * All cryptographic operations for GraphKey.
 *
 * DESIGN DECISIONS:
 *  - PBKDF2-SHA256: well-tested, built into Node.js crypto module (no extra deps)
 *  - 64-byte (512-bit) output: overkill but free — provides massive collision margin
 *  - Async pbkdf2: never blocks the Node.js event loop (CPU-bound operation)
 *  - timingSafeEqual: prevents attackers from guessing the verifier byte-by-byte
 *    by measuring response time differences
 *
 * WHAT IS NEVER DONE HERE:
 *  - No logging of passwords, point strings, salts, or derived keys
 *  - No synchronous pbkdf2Sync (would freeze the server during hashing)
 *  - No MD5, SHA-1, or any deprecated digest
 */

const crypto = require('crypto');

// ── Constants ────────────────────────────────────────────────────
const DIGEST     = 'sha256';
const KEY_LENGTH = 64; // bytes  (512-bit output)
const SALT_BYTES = 32; // bytes  (256-bit salt)

/**
 * generateSalt()
 * Returns a 64-character hexadecimal string (32 random bytes).
 * Each user gets a unique salt so identical graphical passwords
 * produce completely different verifiers in the database.
 *
 * @returns {string} 64-char hex string
 */
function generateSalt() {
  return crypto.randomBytes(SALT_BYTES).toString('hex');
}

/**
 * deriveVerifier(pointString, salt, iterations)
 * Runs PBKDF2-SHA256 on the serialized point string and returns
 * the derived key as a hex string. This is what gets stored in the DB.
 *
 * @param {string} pointString  — canonical point string, e.g. "img1:3,5:7,2:1,8:6,4"
 * @param {string} salt         — hex salt from generateSalt()
 * @param {number} iterations   — PBKDF2 round count (e.g. 210000)
 * @returns {Promise<string>}   — 128-char hex verifier
 */
function deriveVerifier(pointString, salt, iterations) {
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(
      pointString,  // password (treated as UTF-8 bytes)
      salt,         // salt (hex string used as raw bytes)
      iterations,   // iteration count
      KEY_LENGTH,   // output length in bytes
      DIGEST,       // hash algorithm
      (err, derivedKey) => {
        if (err) return reject(err);
        resolve(derivedKey.toString('hex'));
      }
    );
  });
}

/**
 * verifyPassword(candidatePointString, storedVerifier, salt, iterations)
 * Derives a verifier from the candidate point string and compares it
 * against the stored verifier using crypto.timingSafeEqual.
 *
 * WHY timingSafeEqual?
 *   A normal === comparison short-circuits at the first non-matching byte.
 *   An attacker can measure microsecond response-time differences to guess
 *   the verifier byte-by-byte. timingSafeEqual always takes the same time
 *   regardless of where (or whether) the buffers differ.
 *
 * @param {string} candidatePointString — from the login attempt
 * @param {string} storedVerifier       — hex string from DB
 * @param {string} salt                 — hex salt from DB
 * @param {number} iterations           — iteration count from DB
 * @returns {Promise<boolean>}
 */
async function verifyPassword(candidatePointString, storedVerifier, salt, iterations) {
  const candidateVerifier = await deriveVerifier(candidatePointString, salt, iterations);

  const candidateBuf = Buffer.from(candidateVerifier, 'hex');
  const storedBuf    = Buffer.from(storedVerifier,    'hex');

  // timingSafeEqual requires both buffers to have the same length.
  // Both are derived from the same KEY_LENGTH so they always match.
  // We guard anyway to prevent crashes on corrupted DB data.
  if (candidateBuf.length !== storedBuf.length) {
    return false;
  }

  return crypto.timingSafeEqual(candidateBuf, storedBuf);
}

module.exports = { generateSalt, deriveVerifier, verifyPassword, SALT_BYTES, KEY_LENGTH };

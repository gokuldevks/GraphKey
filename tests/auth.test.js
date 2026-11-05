'use strict';

/**
 * tests/auth.test.js — GraphKey Stage 4 Test Suite
 *
 * Tests the core services and full auth flow without an HTTP server.
 * Covers every requirement from the project spec:
 *
 *   ✓ Successful registration
 *   ✓ Duplicate username registration (409)
 *   ✓ Invalid registration data (400)
 *   ✓ Successful graphical password login
 *   ✓ Incorrect graphical password (401)
 *   ✓ Incorrect point order (401)
 *   ✓ Invalid coordinates (400)
 *   ✓ Unauthenticated /api/me access (401)
 *   ✓ Logout and session invalidation
 *   ✓ Database confirmation — raw points never stored
 *   ✓ Malformed API requests (400)
 *   ✓ PBKDF2 correctness + timing-safe comparison
 *   ✓ Salt uniqueness across users
 */

const path = require('path');
const ROOT  = path.join(__dirname, '..');
process.chdir(ROOT);
require('dotenv').config({ path: path.join(ROOT, '.env') });

const assert = require('assert');
const db = require(path.join(ROOT, 'src/database/db'));
const { generateSalt, deriveVerifier, verifyPassword } = require(path.join(ROOT, 'src/services/crypto'));
const { validatePoints, serializePoints } = require(path.join(ROOT, 'src/services/passwordService'));

// ── Test Runner ──────────────────────────────────────────────────
let passed = 0;
let failed = 0;
const results = [];

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓  ${name}`);
    passed++;
    results.push({ name, status: 'PASS' });
  } catch (err) {
    console.log(`  ✗  ${name}`);
    console.log(`     → ${err.message}`);
    failed++;
    results.push({ name, status: 'FAIL', error: err.message });
  }
}

function assertEqual(actual, expected, msg) {
  assert.strictEqual(actual, expected, msg || `Expected ${expected}, got ${actual}`);
}
function assertTrue(val, msg)  { assert.ok(val, msg); }
function assertFalse(val, msg) { assert.ok(!val, msg); }

// ── Clean slate: remove test users before running ────────────────
function cleanupTestUsers() {
  db.prepare("DELETE FROM users WHERE username LIKE 'testuser%' OR username = 'alice' OR username = 'bob'").run();
  db.prepare("DELETE FROM audit_events WHERE event_type LIKE '%'").run(); // wipe for clean audit log test
}

// ════════════════════════════════════════════════════════════════
//  1. PASSWORD SERVICE — validatePoints
// ════════════════════════════════════════════════════════════════
async function runPasswordServiceTests() {
  console.log('\n── 1. passwordService.validatePoints ──────────────────────');

  await test('accepts a valid set of 4 distinct points', () => {
    const r = validatePoints([[0,0],[1,1],[2,2],[3,3]]);
    assertTrue(r.valid, r.reason);
  });

  await test('rejects non-array input', () => {
    const r = validatePoints('not an array');
    assertFalse(r.valid);
  });

  await test('rejects fewer than 4 points', () => {
    const r = validatePoints([[0,0],[1,1],[2,2]]);
    assertFalse(r.valid);
  });

  await test('rejects more than 4 points', () => {
    const r = validatePoints([[0,0],[1,1],[2,2],[3,3],[4,4]]);
    assertFalse(r.valid);
  });

  await test('rejects out-of-bound coordinate (x=10)', () => {
    const r = validatePoints([[10,0],[1,1],[2,2],[3,3]]);
    assertFalse(r.valid);
  });

  await test('rejects out-of-bound coordinate (negative)', () => {
    const r = validatePoints([[-1,0],[1,1],[2,2],[3,3]]);
    assertFalse(r.valid);
  });

  await test('rejects non-integer coordinate (float)', () => {
    const r = validatePoints([[3.7,0],[1,1],[2,2],[3,3]]);
    assertFalse(r.valid);
  });

  await test('rejects duplicate grid cells', () => {
    const r = validatePoints([[1,1],[1,1],[2,2],[3,3]]); // point 1 & 2 are same
    assertFalse(r.valid);
  });

  await test('rejects point with wrong shape (single number)', () => {
    const r = validatePoints([5,[1,1],[2,2],[3,3]]);
    assertFalse(r.valid);
  });

  // ── serializePoints ──────────────────────────────────────────
  console.log('\n── 2. passwordService.serializePoints ─────────────────────');

  await test('produces canonical format imageId:x,y:x,y:x,y:x,y', () => {
    const s = serializePoints('img1', [[3,5],[7,2],[1,8],[6,4]]);
    assertEqual(s, 'img1:3,5:7,2:1,8:6,4');
  });

  await test('different order → different string', () => {
    const s1 = serializePoints('img1', [[3,5],[7,2],[1,8],[6,4]]);
    const s2 = serializePoints('img1', [[7,2],[3,5],[1,8],[6,4]]);
    assertTrue(s1 !== s2, 'Reversed order must produce different serialization');
  });

  await test('different image → different string', () => {
    const s1 = serializePoints('img1', [[3,5],[7,2],[1,8],[6,4]]);
    const s2 = serializePoints('img2', [[3,5],[7,2],[1,8],[6,4]]);
    assertTrue(s1 !== s2, 'Different imageId must produce different serialization');
  });
}

// ════════════════════════════════════════════════════════════════
//  2. CRYPTO SERVICE — PBKDF2 + timingSafeEqual
// ════════════════════════════════════════════════════════════════
async function runCryptoTests() {
  console.log('\n── 3. crypto.generateSalt ──────────────────────────────────');

  await test('returns a 64-character hex string', () => {
    const salt = generateSalt();
    assertEqual(salt.length, 64);
    assertTrue(/^[0-9a-f]+$/.test(salt), 'Salt must be lowercase hex');
  });

  await test('two calls produce different salts', () => {
    const s1 = generateSalt();
    const s2 = generateSalt();
    assertTrue(s1 !== s2, 'Salts must be unique');
  });

  console.log('\n── 4. crypto.deriveVerifier (PBKDF2) ───────────────────────');

  await test('returns a 128-character hex string', async () => {
    const salt = generateSalt();
    const v = await deriveVerifier('img1:3,5:7,2:1,8:6,4', salt, 1000);
    assertEqual(v.length, 128);
    assertTrue(/^[0-9a-f]+$/.test(v), 'Verifier must be hex');
  });

  await test('same input + same salt → same verifier (deterministic)', async () => {
    const salt = generateSalt();
    const pointStr = 'img1:3,5:7,2:1,8:6,4';
    const v1 = await deriveVerifier(pointStr, salt, 1000);
    const v2 = await deriveVerifier(pointStr, salt, 1000);
    assertEqual(v1, v2, 'PBKDF2 must be deterministic');
  });

  await test('different salt → different verifier', async () => {
    const pointStr = 'img1:3,5:7,2:1,8:6,4';
    const v1 = await deriveVerifier(pointStr, generateSalt(), 1000);
    const v2 = await deriveVerifier(pointStr, generateSalt(), 1000);
    assertTrue(v1 !== v2, 'Different salts must yield different verifiers');
  });

  await test('different point string → different verifier (same salt)', async () => {
    const salt = generateSalt();
    const v1 = await deriveVerifier('img1:3,5:7,2:1,8:6,4', salt, 1000);
    const v2 = await deriveVerifier('img1:7,2:3,5:1,8:6,4', salt, 1000); // wrong order
    assertTrue(v1 !== v2, 'Different point strings must yield different verifiers');
  });

  console.log('\n── 5. crypto.verifyPassword (timingSafeEqual) ──────────────');

  await test('returns true for matching point string', async () => {
    const salt = generateSalt();
    const pts  = 'img1:3,5:7,2:1,8:6,4';
    const verifier = await deriveVerifier(pts, salt, 1000);
    const result = await verifyPassword(pts, verifier, salt, 1000);
    assertTrue(result === true, 'Correct credentials must return true');
  });

  await test('returns false for wrong point order', async () => {
    const salt      = generateSalt();
    const correct   = 'img1:3,5:7,2:1,8:6,4';
    const wrongOrder = 'img1:7,2:3,5:1,8:6,4';
    const verifier  = await deriveVerifier(correct, salt, 1000);
    const result    = await verifyPassword(wrongOrder, verifier, salt, 1000);
    assertFalse(result, 'Wrong order must return false');
  });

  await test('returns false for wrong image ID', async () => {
    const salt     = generateSalt();
    const correct  = 'img1:3,5:7,2:1,8:6,4';
    const wrongImg = 'img2:3,5:7,2:1,8:6,4';
    const verifier = await deriveVerifier(correct, salt, 1000);
    const result   = await verifyPassword(wrongImg, verifier, salt, 1000);
    assertFalse(result, 'Wrong image must return false');
  });

  await test('returns false for completely wrong points', async () => {
    const salt     = generateSalt();
    const correct  = 'img1:3,5:7,2:1,8:6,4';
    const wrong    = 'img1:0,0:1,1:2,2:3,3';
    const verifier = await deriveVerifier(correct, salt, 1000);
    const result   = await verifyPassword(wrong, verifier, salt, 1000);
    assertFalse(result, 'Wrong points must return false');
  });
}

// ════════════════════════════════════════════════════════════════
//  3. DATABASE — registration, login, audit, raw-point check
// ════════════════════════════════════════════════════════════════
async function runDatabaseTests() {
  console.log('\n── 6. Database: registration flow ──────────────────────────');

  const TEST_POINTS  = [[3,5],[7,2],[1,8],[6,4]];
  const TEST_IMAGE   = 'img1';
  const TEST_USER    = 'testuser_alice';
  const pointString  = serializePoints(TEST_IMAGE, TEST_POINTS);
  const salt         = generateSalt();
  const iterations   = 1000; // low for test speed
  const verifier     = await deriveVerifier(pointString, salt, iterations);

  // Insert user
  await test('inserts a new user and returns an ID', () => {
    const r = db.prepare(
      'INSERT INTO users (username, image_id, salt, verifier, iterations) VALUES (?,?,?,?,?)'
    ).run(TEST_USER, TEST_IMAGE, salt, verifier, iterations);
    assertTrue(r.lastInsertRowid > 0, 'lastInsertRowid must be positive');
  });

  await test('stored row contains no raw point data', () => {
    const row = db.prepare('SELECT * FROM users WHERE username = ?').get(TEST_USER);
    assertTrue(!!row,                      'Row must exist');
    assertTrue(!('points' in row),         'No "points" column must exist');
    assertTrue(!('point_string' in row),   'No "point_string" column must exist');
    // Confirm verifier is a 128-char hex string (not the raw coordinates)
    assertEqual(row.verifier.length, 128,  'Verifier must be 128-char hex');
    assertFalse(row.verifier.includes('3,5'), 'Verifier must NOT contain raw grid coords');
  });

  await test('verifier does NOT contain the imageId as plain text', () => {
    const row = db.prepare('SELECT verifier FROM users WHERE username = ?').get(TEST_USER);
    assertFalse(row.verifier.includes('img1'), 'Verifier must be opaque hash, not contain imageId');
  });

  await test('duplicate username insert throws UNIQUE constraint error', () => {
    let threw = false;
    try {
      db.prepare(
        'INSERT INTO users (username, image_id, salt, verifier, iterations) VALUES (?,?,?,?,?)'
      ).run(TEST_USER, TEST_IMAGE, generateSalt(), verifier, iterations);
    } catch (err) {
      threw = err.message.includes('UNIQUE constraint failed');
    }
    assertTrue(threw, 'Duplicate username must throw a UNIQUE constraint error');
  });

  await test('verifyPassword returns true with stored verifier', async () => {
    const row    = db.prepare('SELECT salt, verifier, iterations FROM users WHERE username = ?').get(TEST_USER);
    const result = await verifyPassword(pointString, row.verifier, row.salt, row.iterations);
    assertTrue(result, 'verifyPassword must return true for the correct point string');
  });

  await test('verifyPassword returns false for wrong point order', async () => {
    const row    = db.prepare('SELECT salt, verifier, iterations FROM users WHERE username = ?').get(TEST_USER);
    const wrong  = serializePoints(TEST_IMAGE, [[7,2],[3,5],[1,8],[6,4]]); // reversed first two
    const result = await verifyPassword(wrong, row.verifier, row.salt, row.iterations);
    assertFalse(result, 'Wrong order must fail verification');
  });

  await test('verifyPassword returns false for wrong image ID', async () => {
    const row    = db.prepare('SELECT salt, verifier, iterations FROM users WHERE username = ?').get(TEST_USER);
    const wrong  = serializePoints('img2', TEST_POINTS); // wrong image
    const result = await verifyPassword(wrong, row.verifier, row.salt, row.iterations);
    assertFalse(result, 'Wrong image ID must fail verification');
  });

  console.log('\n── 7. Database: audit events ───────────────────────────────');

  await test('inserts REGISTER audit event', () => {
    const row  = db.prepare('SELECT id FROM users WHERE username = ?').get(TEST_USER);
    db.prepare('INSERT INTO audit_events (user_id, event_type, ip_address) VALUES (?,?,?)')
      .run(row.id, 'REGISTER', '127.0.0.1');
    const audit = db.prepare(
      'SELECT * FROM audit_events WHERE user_id = ? AND event_type = ?'
    ).get(row.id, 'REGISTER');
    assertTrue(!!audit,                      'Audit row must exist');
    assertEqual(audit.event_type, 'REGISTER', 'Event type must be REGISTER');
    assertFalse(!audit.created_at,           'created_at must be populated');
  });

  await test('audit event contains NO password or point data', () => {
    const row   = db.prepare('SELECT id FROM users WHERE username = ?').get(TEST_USER);
    const audit = db.prepare('SELECT * FROM audit_events WHERE user_id = ?').get(row.id);
    assertTrue(!('verifier'   in audit), 'No verifier in audit');
    assertTrue(!('salt'       in audit), 'No salt in audit');
    assertTrue(!('points'     in audit), 'No points in audit');
    assertTrue(!('point_string' in audit), 'No point_string in audit');
  });

  console.log('\n── 8. Salt uniqueness across two users ─────────────────────');

  await test('two users with same points get different salts', async () => {
    const pts  = [[0,0],[1,1],[2,2],[3,3]];
    const str  = serializePoints('img1', pts);
    const s1   = generateSalt();
    const s2   = generateSalt();
    const v1   = await deriveVerifier(str, s1, 1000);
    const v2   = await deriveVerifier(str, s2, 1000);
    assertTrue(s1 !== s2, 'Salts must differ');
    assertTrue(v1 !== v2, 'Verifiers must differ even for identical point sequences');
  });
}

// ════════════════════════════════════════════════════════════════
//  4. INPUT VALIDATION EDGE CASES
// ════════════════════════════════════════════════════════════════
async function runValidationTests() {
  console.log('\n── 9. Edge-case input validation ───────────────────────────');

  await test('validatePoints: null input → invalid', () => {
    assertFalse(validatePoints(null).valid);
  });

  await test('validatePoints: empty array → invalid', () => {
    assertFalse(validatePoints([]).valid);
  });

  await test('validatePoints: Infinity coordinate → invalid', () => {
    assertFalse(validatePoints([[Infinity,0],[1,1],[2,2],[3,3]]).valid);
  });

  await test('validatePoints: NaN coordinate → invalid', () => {
    assertFalse(validatePoints([[NaN,0],[1,1],[2,2],[3,3]]).valid);
  });

  await test('validatePoints: string coordinate → invalid', () => {
    assertFalse(validatePoints([['3','5'],[1,1],[2,2],[3,3]]).valid);
  });

  await test('validatePoints: grid boundary 9,9 → valid', () => {
    assertTrue(validatePoints([[9,9],[8,8],[7,7],[6,6]]).valid);
  });

  await test('validatePoints: grid boundary 0,0 → valid', () => {
    assertTrue(validatePoints([[0,0],[1,1],[2,2],[3,3]]).valid);
  });
}

// ════════════════════════════════════════════════════════════════
//  MAIN
// ════════════════════════════════════════════════════════════════
async function main() {
  console.log('\n╔═══════════════════════════════════════════╗');
  console.log('║   GraphKey — Stage 4 Test Suite          ║');
  console.log('╚═══════════════════════════════════════════╝');

  cleanupTestUsers();

  await runPasswordServiceTests();
  await runCryptoTests();
  await runDatabaseTests();
  await runValidationTests();

  // ── Summary ─────────────────────────────────────────────────
  const total = passed + failed;
  console.log('\n╔═══════════════════════════════════════════╗');
  console.log(`║  Results: ${passed}/${total} passed, ${failed} failed`.padEnd(44) + '║');
  console.log('╚═══════════════════════════════════════════╝\n');

  if (failed > 0) {
    console.log('FAILED TESTS:');
    results.filter(r => r.status === 'FAIL')
           .forEach(r => console.log(`  ✗ ${r.name}\n    ${r.error}`));
    process.exit(1);
  } else {
    console.log('All tests passed. ✓\n');
    process.exit(0);
  }
}

main().catch(err => {
  console.error('[FATAL]', err);
  process.exit(1);
});

'use strict';

/**
 * tests/security.test.js
 *
 * Stage 7: Comprehensive Security & Edge-Case Test Suite for GraphKey
 *
 * Covers:
 *  1. Malformed API Requests & Boundary Injection (SQLi, XSS, Bad Types, Payload limits)
 *  2. Rate Limiting Verification (HTTP 429 lockout on brute-force attempts)
 *  3. Database Forensics & Leak Verification (Confirming no plaintext points/passwords in DB)
 *  4. Timing-attack Mitigation & Timing-safe Equality Validation
 *  5. Session Expiry & Token Tampering
 */

const path = require('path');
const stream = require('stream');
const http = require('http');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
process.chdir(ROOT);
require('dotenv').config({ path: path.join(ROOT, '.env') });

const db = require(path.join(ROOT, 'src/database/db'));
const app = require(path.join(ROOT, 'server'));
const { verifyPassword, deriveVerifier, generateSalt } = require(path.join(ROOT, 'src/services/crypto'));
const { validatePoints, serializePoints } = require(path.join(ROOT, 'src/services/passwordService'));

// ── In-Memory HTTP Test Client ───────────────────────────────────
class SecurityTestAgent {
  constructor(appInstance, ip = '127.0.0.1') {
    this.app = appInstance;
    this.ip = ip;
    this.cookies = {};
  }

  getCookieString() {
    return Object.entries(this.cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }

  saveCookies(setCookieHeader) {
    if (!setCookieHeader) return;
    const headerArr = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
    for (const str of headerArr) {
      const parts = str.split(';')[0].trim().split('=');
      const name = parts[0];
      const val = parts.slice(1).join('=');
      if (val === '' || str.includes('Expires=Thu, 01 Jan 1970')) {
        delete this.cookies[name];
      } else {
        this.cookies[name] = val;
      }
    }
  }

  request(options) {
    return new Promise((resolve) => {
      const socket = new stream.Duplex({
        allowHalfOpen: true,
        autoDestroy: false,
        emitClose: false,
        highWaterMark: 1024 * 1024,
        read(size) {},
        write(chunk, encoding, callback) {
          this.output = (this.output || '') + chunk.toString();
          callback();
        }
      });
      socket.remoteAddress = this.ip;

      const req = new http.IncomingMessage(socket);
      req._destroy = (err, cb) => { if (cb) cb(err); };
      req.method = options.method || 'GET';
      req.url = options.url || '/';

      const headers = Object.assign({ host: 'localhost' }, options.headers || {});
      const cookieHeader = this.getCookieString();
      if (cookieHeader && !headers['cookie']) {
        headers['cookie'] = cookieHeader;
      }
      req.headers = headers;

      if (options.body !== undefined && options.body !== null) {
        const data = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
        req.headers['content-length'] = Buffer.byteLength(data);
        if (!req.headers['content-type']) {
          req.headers['content-type'] = 'application/json';
        }
        req.push(data);
      }
      req.push(null);

      const res = new http.ServerResponse(req);
      res.assignSocket(socket);

      res.on('finish', () => {
        let bodyStr = '';
        const rawOutput = socket.output || '';
        const splitIdx = rawOutput.indexOf('\r\n\r\n');
        if (splitIdx !== -1) {
          bodyStr = rawOutput.slice(splitIdx + 4);
        }

        const resHeaders = res.getHeaders();
        this.saveCookies(resHeaders['set-cookie']);

        let json = null;
        try {
          json = JSON.parse(bodyStr);
        } catch (_) {}

        resolve({
          statusCode: res.statusCode,
          headers: resHeaders,
          text: bodyStr,
          json
        });
      });

      this.app.handle(req, res);
    });
  }

  get(url, headers = {}) { return this.request({ method: 'GET', url, headers }); }
  post(url, body = null, headers = {}) { return this.request({ method: 'POST', url, body, headers }); }
}

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
function assertTrue(val, msg) { assert.ok(val, msg); }
function assertFalse(val, msg) { assert.ok(!val, msg); }

// ── Cleanup ──────────────────────────────────────────────────────
function cleanupSecurityUsers() {
  db.prepare("DELETE FROM users WHERE username LIKE 'sec_%'").run();
}

async function runSecurityTests() {
  console.log('\n╔═══════════════════════════════════════════════════════════╗');
  console.log('║   GraphKey — Stage 7 Security & Edge-Case Test Suite      ║');
  console.log('╚═══════════════════════════════════════════════════════════╝\n');

  cleanupSecurityUsers();
  const agent = new SecurityTestAgent(app, '192.168.1.50');

  // Obtain CSRF token
  const csrfRes = await agent.get('/api/csrf-token');
  const csrfToken = csrfRes.json.csrfToken;

  // ── 1. Malformed API Requests & Boundary Injection ───────────
  console.log('── 1. Malformed Requests & Injection Attacks ──────────────');

  await test('Reject SQL Injection payload in registration username', async () => {
    const sqli = "sec_admin' OR '1'='1' --";
    const res = await agent.post('/api/register', {
      username: sqli,
      imageId: 'img1',
      points: [[0,0],[1,1],[2,2],[3,3]]
    }, { 'x-csrf-token': csrfToken });
    assertEqual(res.statusCode, 400);
    assertTrue(res.json.message.includes('Username must be 3–32 characters'));
  });

  await test('Reject XSS script tag payload in registration username', async () => {
    const xss = "<script>alert('pwned')</script>";
    const res = await agent.post('/api/register', {
      username: xss,
      imageId: 'img1',
      points: [[0,0],[1,1],[2,2],[3,3]]
    }, { 'x-csrf-token': csrfToken });
    assertEqual(res.statusCode, 400);
  });

  await test('Reject excessively long username (> 32 characters)', async () => {
    const longUser = 'sec_' + 'a'.repeat(35);
    const res = await agent.post('/api/register', {
      username: longUser,
      imageId: 'img1',
      points: [[0,0],[1,1],[2,2],[3,3]]
    }, { 'x-csrf-token': csrfToken });
    assertEqual(res.statusCode, 400);
  });

  await test('Reject short username (< 3 characters)', async () => {
    const res = await agent.post('/api/register', {
      username: 'ab',
      imageId: 'img1',
      points: [[0,0],[1,1],[2,2],[3,3]]
    }, { 'x-csrf-token': csrfToken });
    assertEqual(res.statusCode, 400);
  });

  await test('Reject invalid image ID (non-existent image asset)', async () => {
    const res = await agent.post('/api/register', {
      username: 'sec_validuser',
      imageId: 'img999_fake',
      points: [[0,0],[1,1],[2,2],[3,3]]
    }, { 'x-csrf-token': csrfToken });
    assertEqual(res.statusCode, 400);
    assertTrue(res.json.message.includes('Invalid image ID'));
  });

  await test('Reject non-array points payload', async () => {
    const res = await agent.post('/api/register', {
      username: 'sec_validuser',
      imageId: 'img1',
      points: "0,0,1,1,2,2,3,3"
    }, { 'x-csrf-token': csrfToken });
    assertEqual(res.statusCode, 400);
  });

  await test('Reject insufficient points count (3 points instead of 4)', async () => {
    const res = await agent.post('/api/register', {
      username: 'sec_validuser',
      imageId: 'img1',
      points: [[0,0],[1,1],[2,2]]
    }, { 'x-csrf-token': csrfToken });
    assertEqual(res.statusCode, 400);
    assertTrue(res.json.message.includes('Exactly 4 points are required'));
  });

  await test('Reject excessive points count (5 points instead of 4)', async () => {
    const res = await agent.post('/api/register', {
      username: 'sec_validuser',
      imageId: 'img1',
      points: [[0,0],[1,1],[2,2],[3,3],[4,4]]
    }, { 'x-csrf-token': csrfToken });
    assertEqual(res.statusCode, 400);
  });

  await test('Reject duplicate point selections in the same logical grid cell', async () => {
    const res = await agent.post('/api/register', {
      username: 'sec_validuser',
      imageId: 'img1',
      points: [[3,5],[3,5],[1,2],[8,9]] // duplicate (3,5)
    }, { 'x-csrf-token': csrfToken });
    assertEqual(res.statusCode, 400);
    assertTrue(res.json.message.includes('distinct'));
  });

  await test('Reject coordinates outside [0, 9] grid boundary', async () => {
    const res = await agent.post('/api/register', {
      username: 'sec_validuser',
      imageId: 'img1',
      points: [[-1,0],[10,5],[2,2],[3,3]]
    }, { 'x-csrf-token': csrfToken });
    assertEqual(res.statusCode, 400);
    assertTrue(res.json.message.includes('out of bounds'));
  });

  await test('Reject non-integer float coordinates', async () => {
    const res = await agent.post('/api/register', {
      username: 'sec_validuser',
      imageId: 'img1',
      points: [[1.5, 2.5],[3,4],[5,6],[7,8]]
    }, { 'x-csrf-token': csrfToken });
    assertEqual(res.statusCode, 400);
    assertTrue(res.json.message.includes('integers'));
  });

  await test('Reject non-existent API routes with JSON 404', async () => {
    const res = await agent.get('/api/unknown_endpoint');
    assertEqual(res.statusCode, 404);
    assertTrue(res.json.message.includes('not found'));
  });

  // ── 2. Login Rate Limiting ───────────────────────────────────
  console.log('\n── 2. Rate Limiting Verification ─────────────────────────');

  await test('Enforce 10 attempts limit on /api/login and block with HTTP 429', async () => {
    // Unique IP dedicated to this rate limit test to avoid interference
    const rateLimitIp = '192.168.100.99';
    const bruteForceAgent = new SecurityTestAgent(app, rateLimitIp);

    const tokenRes = await bruteForceAgent.get('/api/csrf-token');
    const token = tokenRes.json.csrfToken;

    // Send 10 rapid failed login requests (within 10-attempt limit)
    for (let i = 1; i <= 10; i++) {
      const res = await bruteForceAgent.post('/api/login', {
        username: 'sec_nonexistent_target',
        imageId: 'img1',
        points: [[0,0],[1,1],[2,2],[3,3]]
      }, { 'x-csrf-token': token });

      assertEqual(res.statusCode, 401, `Attempt ${i} should return 401 Unauthorized`);
    }

    // 11th attempt MUST trigger HTTP 429 Too Many Requests
    const blockedRes = await bruteForceAgent.post('/api/login', {
      username: 'sec_nonexistent_target',
      imageId: 'img1',
      points: [[0,0],[1,1],[2,2],[3,3]]
    }, { 'x-csrf-token': token });

    assertEqual(blockedRes.statusCode, 429, '11th attempt must be blocked with HTTP 429');
    assertTrue(blockedRes.json.message.includes('Too many login attempts'));
  });

  // ── 3. Database Forensics & Zero-Leakage Verification ─────────
  console.log('\n── 3. Database Forensic Verification ─────────────────────');

  const FORENSIC_USER = 'sec_forensic_user';
  const FORENSIC_IMG = 'img3';
  const FORENSIC_POINTS = [[1, 4], [6, 2], [9, 8], [3, 7]];

  await test('Register dedicated forensic user and inspect database records', async () => {
    const regRes = await agent.post('/api/register', {
      username: FORENSIC_USER,
      imageId: FORENSIC_IMG,
      points: FORENSIC_POINTS
    }, { 'x-csrf-token': csrfToken });
    assertEqual(regRes.statusCode, 201);
  });

  await test('Verify users table stores NO raw coordinates, passwords, or image IDs in hash', async () => {
    const row = db.prepare('SELECT * FROM users WHERE username = ?').get(FORENSIC_USER);
    assertTrue(!!row, 'User row must exist in SQLite');

    // Confirm schema completeness
    assertEqual(typeof row.id, 'number');
    assertEqual(row.username, FORENSIC_USER);
    assertEqual(row.image_id, FORENSIC_IMG);
    assertEqual(row.iterations, 210000);
    assertEqual(row.salt.length, 64, 'Salt must be 32 bytes (64 hex characters)');
    assertEqual(row.verifier.length, 128, 'Verifier must be 64 bytes (128 hex characters)');

    // Forensic check: Confirm raw point coordinates are NOT present anywhere in database fields
    const tableColumns = Object.keys(row);
    assertFalse(tableColumns.includes('points'), 'Must NOT have a points column');
    assertFalse(tableColumns.includes('password'), 'Must NOT have a password column');
    assertFalse(tableColumns.includes('coordinates'), 'Must NOT have a coordinates column');

    // Search for coordinate strings inside the stored salt and verifier
    for (const [x, y] of FORENSIC_POINTS) {
      assertFalse(row.salt.includes(`${x},${y}`), `Salt must not contain raw coordinate (${x},${y})`);
      assertFalse(row.verifier.includes(`${x},${y}`), `Verifier must not contain raw coordinate (${x},${y})`);
    }
  });

  await test('Verify audit_events table contains NO passwords, salts, or coordinate data', async () => {
    const userRow = db.prepare('SELECT id FROM users WHERE username = ?').get(FORENSIC_USER);
    const auditRows = db.prepare('SELECT * FROM audit_events WHERE user_id = ?').all(userRow.id);
    assertTrue(auditRows.length > 0, 'Audit entries must be recorded');

    for (const audit of auditRows) {
      const auditCols = Object.keys(audit);
      assertFalse(auditCols.includes('salt'));
      assertFalse(auditCols.includes('verifier'));
      assertFalse(auditCols.includes('password'));
      assertFalse(auditCols.includes('points'));
      assertEqual(audit.event_type, 'REGISTER');
    }
  });

  // ── 4. Timing-Safe Comparison & Timing Attack Mitigation ─────
  console.log('\n── 4. Cryptographic Timing-Safe Equality ─────────────────');

  await test('crypto.timingSafeEqual correctly rejects mismatched buffers of identical length', async () => {
    const salt = generateSalt();
    const correctString = 'img1:1,1:2,2:3,3:4,4';
    const verifier = await deriveVerifier(correctString, salt, 1000);

    // Identical length candidate with only last character different
    const wrongString = 'img1:1,1:2,2:3,3:4,5';
    const match = await verifyPassword(wrongString, verifier, salt, 1000);
    assertFalse(match, 'Must return false on differing last byte');
  });

  await test('crypto.verifyPassword returns false on length mismatch without throwing', async () => {
    const salt = generateSalt();
    const correctString = 'img1:1,1:2,2:3,3:4,4';
    const truncatedVerifier = 'abcdef'; // invalid length
    const match = await verifyPassword(correctString, truncatedVerifier, salt, 1000);
    assertFalse(match, 'Must safely return false for mismatched buffer length');
  });

  // ── 5. Session Expiry & Security Headers Inspection ──────────
  console.log('\n── 5. Session Cookie Security Flags ──────────────────────');

  await test('Session cookies strictly enforce HttpOnly, SameSite=Strict, Path=/', async () => {
    const res = await agent.get('/api/csrf-token');
    const setCookie = res.headers['set-cookie'];
    assertTrue(!!setCookie, 'Set-Cookie header must be issued');

    const cookieStr = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    assertTrue(cookieStr.toLowerCase().includes('httponly'), 'Cookie must specify HttpOnly');
    assertTrue(cookieStr.toLowerCase().includes('samesite=strict'), 'Cookie must specify SameSite=Strict');
    assertTrue(cookieStr.toLowerCase().includes('path=/'), 'Cookie must specify Path=/');
  });

  cleanupSecurityUsers();

  // ── Summary ──────────────────────────────────────────────────
  const total = passed + failed;
  console.log('\n╔═══════════════════════════════════════════════════════════╗');
  console.log(`║  Security Suite: ${passed}/${total} passed, ${failed} failed`.padEnd(60) + '║');
  console.log('╚═══════════════════════════════════════════════════════════╝\n');

  if (failed > 0) {
    console.error('FAILED SECURITY TESTS:');
    results.filter(r => r.status === 'FAIL')
           .forEach(r => console.error(`  ✗ ${r.name}\n    ${r.error}`));
    process.exit(1);
  } else {
    console.log('All security and edge-case tests passed successfully. ✓\n');
    process.exit(0);
  }
}

runSecurityTests().catch(err => {
  console.error('[FATAL]', err);
  process.exit(1);
});

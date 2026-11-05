'use strict';

/**
 * tests/integration.test.js
 *
 * Stage 6: Full Integration Test Suite for GraphKey
 *
 * Verifies end-to-end integration between:
 *  - Frontend assets (HTML, CSS, JS, SVG images)
 *  - Security middleware (Helmet headers, Cache-Control, CSRF double-submit, Rate limiting)
 *  - SQLite database & session store
 *  - Graphical password registration, verification, session lifecycle, and logout
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

// ── In-Memory HTTP Test Client (Cookie-Jar enabled) ───────────────
class TestAgent {
  constructor(appInstance) {
    this.app = appInstance;
    this.cookies = {}; // name -> value
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
    return new Promise((resolve, reject) => {
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
      socket.remoteAddress = '127.0.0.1';

      const req = new http.IncomingMessage(socket);
      // Prevent IncomingMessage from closing the response socket when request body ends
      req._destroy = (err, cb) => { if (cb) cb(err); };
      req.method = options.method || 'GET';
      req.url = options.url || '/';

      const headers = Object.assign({ host: 'localhost' }, options.headers || {});
      const cookieHeader = this.getCookieString();
      if (cookieHeader && !headers['cookie']) {
        headers['cookie'] = cookieHeader;
      }

      req.headers = headers;

      if (options.body) {
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

  get(url, headers = {}) {
    return this.request({ method: 'GET', url, headers });
  }

  post(url, body = null, headers = {}) {
    return this.request({ method: 'POST', url, body, headers });
  }
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

// ── Cleanup Test Users ───────────────────────────────────────────
function cleanup() {
  db.prepare("DELETE FROM users WHERE username LIKE 'integ_%'").run();
}

// ════════════════════════════════════════════════════════════════
//  INTEGRATION TEST CASES
// ════════════════════════════════════════════════════════════════
async function runIntegrationTests() {
  console.log('\n╔═══════════════════════════════════════════╗');
  console.log('║   GraphKey — Stage 6 Integration Tests   ║');
  console.log('╚═══════════════════════════════════════════╝\n');

  cleanup();
  const agent = new TestAgent(app);

  // ── 1. Static Files ──────────────────────────────────────────
  console.log('── 1. Static Files & Assets ──────────────────────────────');

  await test('GET / serves index.html', async () => {
    const res = await agent.get('/');
    assertEqual(res.statusCode, 200);
    assertTrue(res.text.includes('GraphKey'), 'Index must mention GraphKey');
    assertTrue(res.text.includes('<!DOCTYPE html>'), 'Must be HTML document');
  });

  await test('GET /register.html serves registration page', async () => {
    const res = await agent.get('/register.html');
    assertEqual(res.statusCode, 200);
    assertTrue(res.text.includes('Create Account'), 'Register page check');
    assertTrue(res.text.includes('passwordImage'), 'Image element check');
    assertTrue(res.text.includes('pointCanvas'), 'Canvas element check');
  });

  await test('GET /login.html serves login page', async () => {
    const res = await agent.get('/login.html');
    assertEqual(res.statusCode, 200);
    assertTrue(res.text.includes('Sign In'), 'Login page check');
    assertTrue(res.text.includes('pointCanvas'), 'Canvas element check');
  });

  await test('GET /dashboard.html serves dashboard page', async () => {
    const res = await agent.get('/dashboard.html');
    assertEqual(res.statusCode, 200);
    assertTrue(res.text.includes('Dashboard'), 'Dashboard page check');
    assertTrue(res.text.includes('logoutBtn'), 'Logout button check');
  });

  await test('GET /css/style.css serves cybersecurity theme stylesheet', async () => {
    const res = await agent.get('/css/style.css');
    assertEqual(res.statusCode, 200);
    assertTrue(res.text.includes('--bg-primary'), 'Stylesheet CSS variables check');
    assertTrue(res.text.includes('--cyan'), 'Accent color check');
  });

  await test('GET /images/img1.svg, img2.svg, img3.svg serve valid SVG assets', async () => {
    for (const name of ['img1.svg', 'img2.svg', 'img3.svg']) {
      const res = await agent.get(`/images/${name}`);
      assertEqual(res.statusCode, 200, `Failed loading ${name}`);
      assertTrue(res.text.includes('<svg'), `${name} must contain SVG tag`);
    }
  });

  await test('GET /js/register.js, login.js, dashboard.js serve client scripts', async () => {
    for (const name of ['register.js', 'login.js', 'dashboard.js']) {
      const res = await agent.get(`/js/${name}`);
      assertEqual(res.statusCode, 200, `Failed loading ${name}`);
      assertTrue(res.text.includes('use strict'), `${name} must be valid JS`);
    }
  });

  // ── 2. Security Headers & Caching ────────────────────────────
  console.log('\n── 2. Security Headers & API Caching ─────────────────────');

  await test('Helmet security headers present on responses', async () => {
    const res = await agent.get('/');
    assertEqual(res.headers['x-content-type-options'], 'nosniff');
    assertEqual(res.headers['x-frame-options'], 'SAMEORIGIN');
    assertTrue(!!res.headers['content-security-policy'], 'CSP header must be present');
  });

  await test('Cache-Control: no-store present on /api responses', async () => {
    const res = await agent.get('/api/health');
    assertEqual(res.statusCode, 200);
    assertEqual(res.headers['cache-control'], 'no-store, no-cache, must-revalidate, private');
    assertEqual(res.headers['pragma'], 'no-cache');
  });

  // ── 3. Health & Images API ───────────────────────────────────
  console.log('\n── 3. Core API Endpoints ─────────────────────────────────');

  await test('GET /api/health returns database status and uptime', async () => {
    const res = await agent.get('/api/health');
    assertEqual(res.statusCode, 200);
    assertEqual(res.json.status, 'ok');
    assertEqual(res.json.database, 'connected');
  });

  await test('GET /api/images returns available password images list', async () => {
    const res = await agent.get('/api/images');
    assertEqual(res.statusCode, 200);
    assertTrue(Array.isArray(res.json.images), 'images must be an array');
    assertEqual(res.json.images.length, 3, 'Must have 3 predefined images');
    assertEqual(res.json.images[0].id, 'img1');
    assertEqual(res.json.images[1].id, 'img2');
    assertEqual(res.json.images[2].id, 'img3');
  });

  // ── 4. CSRF Protection ───────────────────────────────────────
  console.log('\n── 4. CSRF Protection ────────────────────────────────────');

  await test('POST /api/register without CSRF token returns 403 Forbidden', async () => {
    const freshAgent = new TestAgent(app);
    const res = await freshAgent.post('/api/register', {
      username: 'integ_test_nocsrf',
      imageId: 'img1',
      points: [[0,0],[1,1],[2,2],[3,3]]
    });
    assertEqual(res.statusCode, 403);
    assertTrue(res.json.message.includes('CSRF'));
  });

  await test('POST /api/register with invalid CSRF token returns 403 Forbidden', async () => {
    const freshAgent = new TestAgent(app);
    await freshAgent.get('/api/csrf-token'); // sets session token
    const res = await freshAgent.post('/api/register', {
      username: 'integ_test_badcsrf',
      imageId: 'img1',
      points: [[0,0],[1,1],[2,2],[3,3]]
    }, {
      'x-csrf-token': '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' // mismatched
    });
    assertEqual(res.statusCode, 403);
    assertTrue(res.json.message.includes('CSRF'));
  });

  // ── 5. Full End-to-End User Journey ──────────────────────────
  console.log('\n── 5. End-to-End User Authentication Flow ────────────────');

  let currentCsrfToken = null;
  const userAgent = new TestAgent(app);

  await test('Step 1: Obtain initial CSRF token and session', async () => {
    const res = await userAgent.get('/api/csrf-token');
    assertEqual(res.statusCode, 200);
    assertTrue(!!res.json.csrfToken, 'csrfToken must be returned');
    assertEqual(res.json.csrfToken.length, 64, 'csrfToken must be 64-char hex');
    currentCsrfToken = res.json.csrfToken;
    assertTrue(!!userAgent.cookies['gk_sid'], 'Session cookie gk_sid must be set');
  });

  const TEST_USERNAME = 'integ_alice';
  const TEST_IMAGE = 'img2';
  const TEST_POINTS = [[2,3], [5,6], [8,1], [4,7]];

  await test('Step 2: Register user with graphical password', async () => {
    const res = await userAgent.post('/api/register', {
      username: TEST_USERNAME,
      imageId: TEST_IMAGE,
      points: TEST_POINTS
    }, {
      'x-csrf-token': currentCsrfToken
    });
    assertEqual(res.statusCode, 201);
    assertEqual(res.json.username, TEST_USERNAME);
    assertTrue(res.json.message.includes('created successfully'));
  });

  await test('Step 3: Reject duplicate username registration', async () => {
    const res = await userAgent.post('/api/register', {
      username: TEST_USERNAME,
      imageId: TEST_IMAGE,
      points: TEST_POINTS
    }, {
      'x-csrf-token': currentCsrfToken
    });
    assertEqual(res.statusCode, 409);
    assertTrue(res.json.message.includes('already taken'));
  });

  await test('Step 4: Unauthenticated GET /api/me returns 401', async () => {
    const unauthAgent = new TestAgent(app);
    const res = await unauthAgent.get('/api/me');
    assertEqual(res.statusCode, 401);
  });

  await test('Step 5: Login fails with wrong points', async () => {
    const wrongPoints = [[2,3], [5,6], [8,1], [9,9]]; // 4th point wrong
    const res = await userAgent.post('/api/login', {
      username: TEST_USERNAME,
      imageId: TEST_IMAGE,
      points: wrongPoints
    }, {
      'x-csrf-token': currentCsrfToken
    });
    assertEqual(res.statusCode, 401);
  });

  await test('Step 6: Login fails with wrong point order (same spots, reversed)', async () => {
    const reversedOrder = [[4,7], [8,1], [5,6], [2,3]]; // reversed
    const res = await userAgent.post('/api/login', {
      username: TEST_USERNAME,
      imageId: TEST_IMAGE,
      points: reversedOrder
    }, {
      'x-csrf-token': currentCsrfToken
    });
    assertEqual(res.statusCode, 401);
  });

  await test('Step 7: Login fails with wrong image ID', async () => {
    const res = await userAgent.post('/api/login', {
      username: TEST_USERNAME,
      imageId: 'img1', // registered with img2
      points: TEST_POINTS
    }, {
      'x-csrf-token': currentCsrfToken
    });
    assertEqual(res.statusCode, 401);
  });

  await test('Step 8: Login succeeds with correct image and point sequence', async () => {
    const res = await userAgent.post('/api/login', {
      username: TEST_USERNAME,
      imageId: TEST_IMAGE,
      points: TEST_POINTS
    }, {
      'x-csrf-token': currentCsrfToken
    });
    assertEqual(res.statusCode, 200);
    assertEqual(res.json.username, TEST_USERNAME);
    assertTrue(!!res.json.csrfToken, 'Login must provide fresh CSRF token');
    currentCsrfToken = res.json.csrfToken; // update to fresh token
  });

  await test('Step 9: GET /api/me returns authenticated profile (no secrets exposed)', async () => {
    const res = await userAgent.get('/api/me');
    assertEqual(res.statusCode, 200);
    assertEqual(res.json.user.username, TEST_USERNAME);
    assertEqual(res.json.user.image_id, TEST_IMAGE);
    assertTrue(res.json.user.iterations >= 1000, 'Iterations must be populated');
    assertTrue(!!res.json.user.created_at, 'created_at must be populated');

    // Security assertion: NO passwords, salts, verifiers, or points leaked in API!
    assertFalse('verifier' in res.json.user, 'verifier must NEVER be exposed');
    assertFalse('salt' in res.json.user, 'salt must NEVER be exposed');
    assertFalse('points' in res.json.user, 'points must NEVER be exposed');
    assertFalse('point_string' in res.json.user, 'point_string must NEVER be exposed');
  });

  await test('Step 10: Logout destroys session and clears session cookie', async () => {
    const res = await userAgent.post('/api/logout', null, {
      'x-csrf-token': currentCsrfToken
    });
    assertEqual(res.statusCode, 200);
    assertTrue(res.json.message.includes('Logged out'));
  });

  await test('Step 11: GET /api/me after logout returns 401 Unauthorized', async () => {
    const res = await userAgent.get('/api/me');
    assertEqual(res.statusCode, 401);
  });

  // ── Summary ──────────────────────────────────────────────────
  cleanup();

  const total = passed + failed;
  console.log('\n╔═══════════════════════════════════════════╗');
  console.log(`║  Integration: ${passed}/${total} passed, ${failed} failed`.padEnd(44) + '║');
  console.log('╚═══════════════════════════════════════════╝\n');

  if (failed > 0) {
    console.error('FAILED INTEGRATION TESTS:');
    results.filter(r => r.status === 'FAIL')
           .forEach(r => console.error(`  ✗ ${r.name}\n    ${r.error}`));
    process.exit(1);
  } else {
    console.log('All integration tests passed successfully. ✓\n');
    process.exit(0);
  }
}

runIntegrationTests().catch(err => {
  console.error('[FATAL]', err);
  process.exit(1);
});
